import { EXTENSION_PREFIX } from "./constants.js";

export function logSplitCheck(message) {
  process.stderr.write(`${EXTENSION_PREFIX} ${message}\n`);
}
