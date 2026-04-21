import { formatUnitLabel } from "./unit.js";
import { EXTENSION_PREFIX, MARKER_KEY, SPLIT_NEEDED_KEY, SPLIT_REASON_KEY } from "./constants.js";

export function buildSplitCheckSystemPrompt({ unit, planPath }) {
  return [
    `${EXTENSION_PREFIX} Split-check mode is active.`,
    `Target unit: ${formatUnitLabel(unit)}`,
    `Task: ${unit.taskTitle}`,
    `Slice: ${unit.sliceId} (${unit.sliceTitle})`,
    `Plan: ${planPath}`,
    "",
    "Do not implement the task yet.",
    "Decide whether the task should be split into smaller tasks first.",
    `Respond with YAML frontmatter containing ${MARKER_KEY}: true.`,
    `Also include ${SPLIT_NEEDED_KEY}: true|false and ${SPLIT_REASON_KEY}: <short reason>.`,
    "Keep the answer concise and structured.",
  ].join("\n");
}

export function assistantMarkedSplitCheckDone(text) {
  return new RegExp(`^${MARKER_KEY}\\s*:\\s*true\\s*$`, "im").test(text);
}
