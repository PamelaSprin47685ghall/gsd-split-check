import { readdirSync } from "node:fs";
import { splitFrontmatter } from "./frontmatter.js";

function parseBooleanLine(text, key) {
  const match = text.match(new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(true|false)\\s*$`, "im"));
  if (!match) return null;
  return match[1].toLowerCase() === "true";
}

function parseStringLine(text, key) {
  const match = text.match(new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSplitCheckResponse(text) {
  const { frontmatterText, body } = splitFrontmatter(text);
  const splitNeeded = parseBooleanLine(frontmatterText, "split_needed");
  const splitReason = parseStringLine(frontmatterText, "split_reason");

  const jsonMatch = body.match(/```(?:json|jsonc)?(?:\s+split_plan)?\s*\n([\s\S]*?)\n```/i);
  let splitPlan = null;
  if (jsonMatch) {
    try {
      splitPlan = JSON.parse(jsonMatch[1]);
    } catch {
      splitPlan = null;
    }
  }

  return {
    splitNeeded,
    splitReason,
    splitPlan,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value.map((item) => item.trim());
}

function readExistingTaskNumbers(tasksDir) {
  try {
    return readdirSync(tasksDir)
      .map((name) => {
        const match = name.match(/^T(\d+)-PLAN\.md$/i);
        return match ? Number(match[1]) : null;
      })
      .filter((value) => Number.isFinite(value));
  } catch {
    return [];
  }
}

function formatTaskId(number, width) {
  return `T${String(number).padStart(width, "0")}`;
}

function nextTaskIdFactory(tasksDir, fallbackTaskId) {
  const existing = readExistingTaskNumbers(tasksDir);
  const currentNumber = Number((fallbackTaskId.match(/^(?:T)(\d+)$/i)?.[1] ?? "0"));
  const maxExisting = existing.length > 0 ? Math.max(...existing) : 0;
  const width = Math.max(2, (fallbackTaskId.match(/^(?:T)(\d+)$/i)?.[1] ?? "00").length, String(maxExisting).length);
  let nextNumber = Math.max(currentNumber, maxExisting) + 1;

  return () => formatTaskId(nextNumber++, width);
}

function normalizeTask(task, label) {
  if (!isPlainObject(task)) {
    throw new Error(`${label} must be an object`);
  }

  return {
    title: requireString(task.title, `${label}.title`),
    description: requireString(task.description, `${label}.description`),
    estimate: requireString(task.estimate, `${label}.estimate`),
    files: requireStringArray(task.files, `${label}.files`),
    verify: requireString(task.verify, `${label}.verify`),
    inputs: requireStringArray(task.inputs, `${label}.inputs`),
    expectedOutput: requireStringArray(task.expectedOutput, `${label}.expectedOutput`),
    observabilityImpact: typeof task.observabilityImpact === "string" ? task.observabilityImpact.trim() : undefined,
  };
}

function extractPlanSections(planContent) {
  const { body } = splitFrontmatter(planContent);
  const sections = {};
  const regex = /^##\s*(.+?)\s*$/gm;
  let match;
  const indices = [];
  while ((match = regex.exec(body)) !== null) {
    indices.push({ title: match[1].trim(), index: match.index });
  }
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].index + indices[i].title.length + 3;
    const end = i + 1 < indices.length ? indices[i + 1].index : body.length;
    sections[indices[i].title.toLowerCase()] = body.slice(start, end).trim();
  }
  return { body: body.trim(), sections };
}

function parseList(text) {
  if (!text) return [];
  return text
    .split(/\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

function pickSection(sections, ...keys) {
  for (const key of keys) {
    const value = sections[key.toLowerCase()];
    if (value !== undefined) return value;
  }
  return "";
}

function buildFallbackTask({ currentTaskId, currentTaskTitle, currentTaskPlanContent }) {
  const { sections } = extractPlanSections(currentTaskPlanContent);

  const estimate = pickSection(sections, "估计", "estimate") || "15m";
  const files = parseList(pickSection(sections, "文件", "files"));
  const inputs = parseList(pickSection(sections, "输入", "inputs"));
  const expectedOutput = parseList(pickSection(sections, "输出", "expected output", "outputs"));
  const verify = pickSection(sections, "验证", "verification") || "npm test";

  return {
    taskId: currentTaskId,
    title: currentTaskTitle,
    description: "[SPLIT-FALLBACK] 原任务已拆分为子任务。请在所有子任务完成后执行验收与集成。",
    estimate,
    files: files.length > 0 ? files : ["src/"],
    verify,
    inputs: inputs.length > 0 ? inputs : [],
    expectedOutput: expectedOutput.length > 0 ? expectedOutput : [],
  };
}

export function buildSplitPlanToolArgs({
  projectDir,
  milestoneId,
  sliceId,
  currentTaskId,
  currentTaskTitle,
  currentTaskPlanContent,
  tasksDir,
  splitPlan,
}) {
  if (!isPlainObject(splitPlan)) {
    throw new Error("split_plan JSON block is required when split_needed is true");
  }

  const goal = requireString(splitPlan.goal, "split_plan.goal");
  const subtasks = Array.isArray(splitPlan.tasks) ? splitPlan.tasks : [];
  if (subtasks.length === 0) {
    throw new Error("split_plan.tasks must contain at least one subtask");
  }

  const nextTaskId = nextTaskIdFactory(tasksDir, currentTaskId);
  const tasks = subtasks.map((task, index) => ({
    taskId: nextTaskId(),
    ...normalizeTask(task, `split_plan.tasks[${index}]`),
  }));

  tasks.push(
    buildFallbackTask({
      currentTaskId,
      currentTaskTitle,
      currentTaskPlanContent,
    })
  );

  return {
    projectDir,
    milestoneId,
    sliceId,
    goal,
    successCriteria: typeof splitPlan.successCriteria === "string" ? splitPlan.successCriteria.trim() : undefined,
    proofLevel: typeof splitPlan.proofLevel === "string" ? splitPlan.proofLevel.trim() : undefined,
    integrationClosure: typeof splitPlan.integrationClosure === "string" ? splitPlan.integrationClosure.trim() : undefined,
    observabilityImpact: typeof splitPlan.observabilityImpact === "string" ? splitPlan.observabilityImpact.trim() : undefined,
    tasks,
  };
}
