import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import registerSplitCheckExtension from "../src/extension.js";
import { documentHasBoolean, setBooleanFrontmatter, splitFrontmatter } from "../src/frontmatter.js";
import { MARKER_KEY } from "../src/constants.js";
import { armSplitCheck, clearSplitCheckState, getArmedSplitCheck } from "../src/state.js";
import { parseSplitCheckResponse, buildSplitPlanToolArgs } from "../src/split-plan.js";
import { parseExecuteTaskUnit, resolveTaskPlanPath } from "../src/unit.js";

function createPiStub() {
  const handlers = new Map();
  return {
    handlers,
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
  };
}

async function withTempProject(callback) {
  const projectDir = mkdtempSync(join(tmpdir(), "gsd-split-check-"));
  mkdirSync(join(projectDir, ".gsd", "milestones", "M001", "slices", "S02", "tasks"), { recursive: true });

  const previousCwd = process.cwd();
  process.chdir(projectDir);
  try {
    return await callback({ projectDir });
  } finally {
    process.chdir(previousCwd);
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

test.beforeEach(() => {
  clearSplitCheckState();
});

test("parseExecuteTaskUnit reads the execute-task header", () => {
  const unit = parseExecuteTaskUnit(`You are executing GSD auto-mode.\n\n## UNIT: Execute Task T03 ("Implement split-check") — Slice S02 ("User flow"), Milestone M001\n\n## Working Directory`);

  assert.deepEqual(unit, {
    taskId: "T03",
    taskTitle: "Implement split-check",
    sliceId: "S02",
    sliceTitle: "User flow",
    milestoneId: "M001",
  });
});

test("frontmatter helpers preserve bodies and add missing markers", () => {
  const original = `---\nstatus: active\n---\n\n# Task body\n`;
  const updated = setBooleanFrontmatter(original, MARKER_KEY, true);

  assert.equal(documentHasBoolean(updated, MARKER_KEY), true);
  assert.equal(splitFrontmatter(updated).body, "\n# Task body\n");
});

test("extension arms an execute-task turn and persists the marker when the assistant confirms it", async () => {
  await withTempProject(async () => {
    const planPath = resolveTaskPlanPath(process.cwd(), {
      milestoneId: "M001",
      sliceId: "S02",
      taskId: "T03",
    });

    writeFileSync(planPath, `---\nstatus: active\n---\n\n# Split check target\n`, "utf-8");

    const pi = createPiStub();
    registerSplitCheckExtension(pi);

    const beforeAgentStart = pi.handlers.get("before_agent_start");
    const agentEnd = pi.handlers.get("agent_end");

    const beforeResult = await beforeAgentStart(
      {
        prompt: `## UNIT: Execute Task T03 ("Implement split-check") — Slice S02 ("User flow"), Milestone M001\n\n## Working Directory`,
        systemPrompt: "Base prompt",
      },
      {},
    );

    assert.equal(typeof beforeResult.systemPrompt, "string");
    assert.match(beforeResult.systemPrompt, /Split-check mode is active/);
    assert.match(beforeResult.systemPrompt, /split_plan/);
    assert.match(beforeResult.systemPrompt, /host workflow tool directly/);
    assert.match(beforeResult.systemPrompt, /fallback/);
    assert.equal(getArmedSplitCheck().planPath, planPath);

    await agentEnd(
      {
        messages: [
          {
            role: "assistant",
            content: `---\nsplit_check_done: true\nsplit_needed: true\nsplit_reason: the task is too broad\n---`,
          },
        ],
      },
      {},
    );

    const persisted = readFileSync(planPath, "utf-8");
    assert.equal(documentHasBoolean(persisted, MARKER_KEY), true);
    assert.equal(getArmedSplitCheck(), null);
  });
});

test("extension directly invokes the split bridge when the assistant returns a split plan", async () => {
  await withTempProject(async () => {
    const planPath = resolveTaskPlanPath(process.cwd(), {
      milestoneId: "M001",
      sliceId: "S02",
      taskId: "T03",
    });

    writeFileSync(planPath, `---\nstatus: active\n---\n\n# Split check target\n`, "utf-8");

    const invoked = { count: 0, armed: null, splitPlan: null };
    const pi = createPiStub();
    registerSplitCheckExtension(pi, {
      invokeSplitPlan: async (armed, splitPlan) => {
        invoked.count += 1;
        invoked.armed = armed;
        invoked.splitPlan = splitPlan;
      },
    });

    const beforeAgentStart = pi.handlers.get("before_agent_start");
    const agentEnd = pi.handlers.get("agent_end");

    await beforeAgentStart(
      {
        prompt: `## UNIT: Execute Task T03 ("Implement split-check") — Slice S02 ("User flow"), Milestone M001\n\n## Working Directory`,
        systemPrompt: "Base prompt",
      },
      {},
    );

    await agentEnd(
      {
        messages: [
          {
            role: "assistant",
            content: `---\nsplit_needed: true\nsplit_reason: the task is too broad\n---\n\n\`\`\`json split_plan\n{\n  \"goal\": \"Break the work into smaller steps.\",\n  \"tasks\": [\n    {\n      \"title\": \"Subtask A\",\n      \"description\": \"Do the first narrow step.\",\n      \"estimate\": \"30m\",\n      \"files\": [\"src/a.ts\"],\n      \"verify\": \"npm test\",\n      \"inputs\": [\"src/input.txt\"],\n      \"expectedOutput\": [\"src/output.txt\"]\n    }\n  ],\n  \"fallback\": {\n    \"title\": \"Implement split-check\",\n    \"description\": \"Verify the subtasks work together.\",\n    \"estimate\": \"15m\",\n    \"files\": [\"src/extension.js\"],\n    \"verify\": \"npm test\",\n    \"inputs\": [\"src/a.ts\"],\n    \"expectedOutput\": [\"src/extension.js\"]\n  }\n}\n\`\`\``,
          },
        ],
      },
      {},
    );

    assert.equal(invoked.count, 1);
    assert.equal(invoked.armed.unit.taskId, "T03");
    assert.equal(invoked.splitPlan.goal, "Break the work into smaller steps.");
    assert.equal(invoked.splitPlan.tasks.length, 1);

    const persisted = readFileSync(planPath, "utf-8");
    assert.equal(documentHasBoolean(persisted, MARKER_KEY), true);
    assert.equal(getArmedSplitCheck(), null);
  });
});

test("session lifecycle clears any armed split-check state", async () => {
  const pi = createPiStub();
  registerSplitCheckExtension(pi);

  armSplitCheck({ planPath: "./fake-plan.md", unit: { milestoneId: "M001", sliceId: "S02", taskId: "T03", taskTitle: "T", sliceTitle: "S" } });
  assert.notEqual(getArmedSplitCheck(), null);

  await pi.handlers.get("session_switch")({}, {});
  assert.equal(getArmedSplitCheck(), null);
});

test("buildSplitPlanToolArgs assigns task IDs after existing ones and preserves fallback ID", async () => {
  await withTempProject(async () => {
    const tasksDir = join(process.cwd(), ".gsd", "milestones", "M001", "slices", "S02", "tasks");
    writeFileSync(join(tasksDir, "T01-PLAN.md"), "---\nstatus: pending\n---\n", "utf-8");
    writeFileSync(join(tasksDir, "T02-PLAN.md"), "---\nstatus: pending\n---\n", "utf-8");

    const args = buildSplitPlanToolArgs({
      projectDir: process.cwd(),
      milestoneId: "M001",
      sliceId: "S02",
      currentTaskId: "T03",
      currentTaskTitle: "Implement split-check",
      currentTaskPlanContent: "---\nstatus: active\n---\n\n## 描述\nBuild the split-check extension.\n\n## 文件\n- src/extension.js\n\n## 验证\nnpm test\n",
      tasksDir,
      splitPlan: {
        goal: "Split the work.",
        tasks: [
          {
            title: "Subtask A",
            description: "First step.",
            estimate: "30m",
            files: ["src/a.ts"],
            verify: "npm test",
            inputs: ["src/input.txt"],
            expectedOutput: ["src/output.txt"],
          },
          {
            title: "Subtask B",
            description: "Second step.",
            estimate: "20m",
            files: ["src/b.ts"],
            verify: "npm test",
            inputs: ["src/b.ts"],
            expectedOutput: ["src/b.ts"],
          },
        ],
      },
    });

    assert.equal(args.tasks.length, 3);
    assert.equal(args.tasks[0].taskId, "T04");
    assert.equal(args.tasks[1].taskId, "T05");
    assert.equal(args.tasks[2].taskId, "T03");
    assert.equal(args.tasks[2].title, "Implement split-check");
    assert.ok(args.tasks[2].description.includes("[SPLIT-FALLBACK]"));
    assert.ok(args.goal);
  });
});
