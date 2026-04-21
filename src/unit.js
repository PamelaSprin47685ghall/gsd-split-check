import { join } from "node:path";
import { EXECUTE_TASK_HEADER_RE } from "./constants.js";

export function parseExecuteTaskUnit(prompt) {
  const match = EXECUTE_TASK_HEADER_RE.exec(prompt);
  if (!match) return null;

  return {
    taskId: match[1].trim(),
    taskTitle: match[2].trim(),
    sliceId: match[3].trim(),
    sliceTitle: match[4].trim(),
    milestoneId: match[5].trim(),
  };
}

export function resolveTaskPlanPath(baseDir, unit) {
  return join(
    baseDir,
    ".gsd",
    "milestones",
    unit.milestoneId,
    "slices",
    unit.sliceId,
    "tasks",
    `${unit.taskId}-PLAN.md`,
  );
}

export function formatUnitLabel(unit) {
  return `${unit.milestoneId}/${unit.sliceId}/${unit.taskId}`;
}
