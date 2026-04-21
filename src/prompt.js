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
    "First decide whether the scope needs to be split into smaller tasks.",
    "",
    `If a split is needed, return YAML frontmatter with ${SPLIT_NEEDED_KEY}: true and ${SPLIT_REASON_KEY}: <short reason>.`,
    "Then include a fenced JSON block named split_plan.",
    "The extension will execute the host workflow tool directly; do not call tools yourself.",
    "",
    "split_plan must contain:",
    "- goal",
    "- optional successCriteria, proofLevel, integrationClosure, observabilityImpact",
    "- tasks: ordered subtask list",
    "",
    "Each task object must include:",
    "- title",
    "- description",
    "- estimate",
    "- files",
    "- verify",
    "- inputs",
    "- expectedOutput",
    "",
    "Keep subtasks focused and make the fallback task verify the combined result.",
    `If no split is needed, return ${SPLIT_NEEDED_KEY}: false and a short reason.`,
    `Respond with YAML frontmatter containing ${MARKER_KEY}: true only if you are explicitly confirming the check completed.`,
    "Keep the answer concise and structured.",
  ].join("\n");
}

export function assistantMarkedSplitCheckDone(text) {
  return new RegExp(`^${MARKER_KEY}\\s*:\\s*true\\s*$`, "im").test(text);
}
