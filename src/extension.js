import { assistantMarkedSplitCheckDone, buildSplitCheckSystemPrompt } from "./prompt.js";
import { documentHasBoolean, setBooleanFrontmatter } from "./frontmatter.js";
import { MARKER_KEY } from "./constants.js";
import { armSplitCheck, clearSplitCheckState, getArmedSplitCheck, isSplitCheckArmedFor } from "./state.js";
import { logSplitCheck } from "./log.js";
import { parseExecuteTaskUnit, resolveTaskPlanPath, formatUnitLabel } from "./unit.js";
import { readTaskPlan, writeTaskPlan } from "./task-plan.js";

function extractAssistantText(messages) {
  const parts = [];
  for (const message of messages ?? []) {
    if (message?.role !== "assistant") continue;

    const { content } = message;
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

function resetTurnState() {
  clearSplitCheckState();
}

function maybeArmSplitCheck(event) {
  const unit = parseExecuteTaskUnit(event.prompt);
  if (!unit) return null;

  const planPath = resolveTaskPlanPath(process.cwd(), unit);
  const plan = readTaskPlan(planPath);
  if (!plan) return null;

  if (documentHasBoolean(plan.content, MARKER_KEY)) {
    resetTurnState();
    return null;
  }

  const armed = armSplitCheck({ unit, planPath });
  logSplitCheck(`armed ${formatUnitLabel(unit)} from ${planPath}`);
  return { unit, planPath, armed };
}

function shouldPersistSplitCheck(assistantText) {
  return assistantMarkedSplitCheckDone(assistantText);
}

export default function registerSplitCheckExtension(pi) {
  pi.on("session_start", async () => {
    resetTurnState();
  });

  pi.on("session_switch", async () => {
    resetTurnState();
  });

  pi.on("session_fork", async () => {
    resetTurnState();
  });

  pi.on("before_agent_start", async (event) => {
    const armed = maybeArmSplitCheck(event);
    if (!armed) return undefined;

    return {
      systemPrompt: [event.systemPrompt, buildSplitCheckSystemPrompt(armed)].filter(Boolean).join("\n\n"),
    };
  });

  pi.on("agent_end", async (event) => {
    const armed = getArmedSplitCheck();
    if (!armed) return undefined;

    try {
      const assistantText = extractAssistantText(event.messages);
      if (!shouldPersistSplitCheck(assistantText)) {
        logSplitCheck(`did not observe ${MARKER_KEY}: true for ${formatUnitLabel(armed.unit)}`);
        return undefined;
      }

      const currentPlan = readTaskPlan(armed.planPath);
      if (!currentPlan) {
        logSplitCheck(`plan missing while persisting ${formatUnitLabel(armed.unit)}: ${armed.planPath}`);
        return undefined;
      }

      if (documentHasBoolean(currentPlan.content, MARKER_KEY)) {
        logSplitCheck(`plan already marked for ${formatUnitLabel(armed.unit)}`);
        return undefined;
      }

      const updated = setBooleanFrontmatter(currentPlan.content, MARKER_KEY, true);
      writeTaskPlan(armed.planPath, updated);
      logSplitCheck(`persisted ${MARKER_KEY} for ${formatUnitLabel(armed.unit)}`);
    }
    finally {
      resetTurnState();
    }
  });
}
