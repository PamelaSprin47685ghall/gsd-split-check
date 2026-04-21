import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER_KEY = "split_check_done";
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const UNIT_HEADER_RE = /^## UNIT:\s+Execute Task\s+(.+?)\s+\("(.+?)"\)\s+—\s+Slice\s+(.+?)\s+\("(.+?)"\),\s+Milestone\s+(.+?)\s*$/m;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unitKey(unit) {
  return `${unit.milestoneId}/${unit.sliceId}/${unit.taskId}`;
}

function parseUnitFromPrompt(prompt) {
  const match = UNIT_HEADER_RE.exec(prompt);
  if (!match) return null;
  return {
    taskId: match[1].trim(),
    taskTitle: match[2].trim(),
    sliceId: match[3].trim(),
    sliceTitle: match[4].trim(),
    milestoneId: match[5].trim(),
  };
}

function taskPlanPath(cwd, unit) {
  return join(
    cwd,
    ".gsd",
    "milestones",
    unit.milestoneId,
    "slices",
    unit.sliceId,
    "tasks",
    `${unit.taskId}-PLAN.md`,
  );
}

function parseFrontmatter(content) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { hasFrontmatter: false, frontmatterText: "", body: content };
  }
  return {
    hasFrontmatter: true,
    frontmatterText: match[1],
    body: content.slice(match[0].length),
  };
}

function frontmatterHasTrue(frontmatterText, key) {
  return new RegExp(`^${escapeRegExp(key)}\\s*:\\s*true\\s*$`, "im").test(frontmatterText);
}

function writeFrontmatterBool(content, key, value) {
  const parsed = parseFrontmatter(content);
  const line = `${key}: ${value ? "true" : "false"}`;

  if (!parsed.hasFrontmatter) {
    const body = content.replace(/^\r?\n+/, "");
    return [`---`, line, `---`, "", body].join("\n");
  }

  const lines = parsed.frontmatterText.split(/\r?\n/);
  let replaced = false;
  const next = lines.map((current) => {
    if (new RegExp(`^${escapeRegExp(key)}\\s*:`, "i").test(current.trim())) {
      replaced = true;
      return line;
    }
    return current;
  });

  if (!replaced) next.push(line);
  const body = parsed.body.replace(/^\r?\n+/, "");
  return [`---`, next.join("\n"), `---`, "", body].join("\n");
}

function readPlan(planPath) {
  if (!existsSync(planPath)) return null;
  const content = readFileSync(planPath, "utf-8");
  return { path: planPath, content };
}

function splitCheckPrompt(unit, planPath) {
  return [
    "Split-check mode is active.",
    `Unit: ${unit.milestoneId}/${unit.sliceId}/${unit.taskId}`,
    `Task: ${unit.taskTitle}`,
    `Slice: ${unit.sliceTitle}`,
    `Plan: ${planPath}`,
    "",
    "Do not execute the task yet.",
    "Decide whether this task should be split into smaller tasks before any implementation work.",
    "Respond with YAML frontmatter that includes split_check_done: true.",
    "If a split is needed, include split_needed: true and a short split_reason.",
    "If no split is needed, include split_needed: false and a short split_reason.",
    "Do not edit files.",
  ].join("\n");
}

function extractAssistantText(messages) {
  const parts = [];
  for (const message of messages ?? []) {
    if (message?.role !== "assistant") continue;
    const content = message.content;
    if (typeof content === "string") {
      parts.push(content);
      continue;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
          parts.push(block.text);
        }
      }
    }
  }
  return parts.join("\n\n");
}

function replaceLastUserMessage(messages, replacement) {
  const next = messages.map((message) => ({ ...message }));
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i]?.role !== "user") continue;
    next[i] = { ...next[i], content: replacement };
    return next;
  }
  return null;
}

export default function registerSplitCheckExtension(pi) {
  const pending = new Map();

  pi.on("before_agent_start", async (event) => {
    const unit = parseUnitFromPrompt(event.prompt);
    if (!unit) return undefined;

    const planPath = taskPlanPath(process.cwd(), unit);
    const plan = readPlan(planPath);
    if (!plan) return undefined;

    if (frontmatterHasTrue(parseFrontmatter(plan.content).frontmatterText, MARKER_KEY)) {
      pending.delete(unitKey(unit));
      return undefined;
    }

    const key = unitKey(unit);
    pending.set(key, {
      unit,
      planPath,
      splitPrompt: splitCheckPrompt(unit, planPath),
    });

    return {
      systemPrompt: [
        event.systemPrompt,
        "Split-check is active. Treat the current turn as a preflight review, not implementation.",
        "The task prompt will be replaced with a split-check prompt before the LLM call.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  });

  pi.on("context", async (event) => {
    const entry = pending.entries().next().value;
    if (!entry) return undefined;
    const [key, state] = entry;

    const currentPlan = readPlan(state.planPath);
    if (!currentPlan) return undefined;
    if (frontmatterHasTrue(parseFrontmatter(currentPlan.content).frontmatterText, MARKER_KEY)) {
      pending.delete(key);
      return undefined;
    }

    const messages = replaceLastUserMessage(event.messages, state.splitPrompt);
    return messages ? { messages } : undefined;
  });

  pi.on("agent_end", async (event) => {
    const assistantText = extractAssistantText(event.messages);
    if (!assistantText) return;

    for (const [key, state] of pending.entries()) {
      const currentPlan = readPlan(state.planPath);
      pending.delete(key);
      if (!currentPlan) continue;
      if (frontmatterHasTrue(parseFrontmatter(currentPlan.content).frontmatterText, MARKER_KEY)) continue;
      if (!new RegExp(`^${escapeRegExp(MARKER_KEY)}\\s*:\\s*true\\s*$`, "im").test(assistantText)) continue;

      const nextContent = writeFrontmatterBool(currentPlan.content, MARKER_KEY, true);
      writeFileSync(state.planPath, nextContent, "utf-8");
      process.stderr.write(`[split-check] marked ${key} as checked in ${state.planPath}\n`);
    }
  });
}
