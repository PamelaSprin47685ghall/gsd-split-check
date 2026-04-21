import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import registerSplitCheckExtension from "../src/extension.js";
import { documentHasBoolean, setBooleanFrontmatter, splitFrontmatter } from "../src/frontmatter.js";
import { MARKER_KEY } from "../src/constants.js";
import { armSplitCheck, clearSplitCheckState, getArmedSplitCheck } from "../src/state.js";
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

function withTempProject(callback) {
  const projectDir = mkdtempSync(join(tmpdir(), "gsd-split-check-"));
  mkdirSync(join(projectDir, ".gsd", "milestones", "M001", "slices", "S02", "tasks"), { recursive: true });

  const previousCwd = process.cwd();
  process.chdir(projectDir);
  try {
    return callback({ projectDir });
  } finally {
    process.chdir(previousCwd);
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

test("session lifecycle clears any armed split-check state", async () => {
  const pi = createPiStub();
  registerSplitCheckExtension(pi);

  armSplitCheck({ planPath: "./fake-plan.md", unit: { milestoneId: "M001", sliceId: "S02", taskId: "T03", taskTitle: "T", sliceTitle: "S" } });
  assert.notEqual(getArmedSplitCheck(), null);

  await pi.handlers.get("session_switch")({}, {});
  assert.equal(getArmedSplitCheck(), null);
});
