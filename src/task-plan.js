import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function readTaskPlan(planPath) {
  if (!existsSync(planPath)) return null;
  return {
    path: planPath,
    content: readFileSync(planPath, "utf-8"),
  };
}

export function writeTaskPlan(planPath, content) {
  writeFileSync(planPath, content, "utf-8");
}
