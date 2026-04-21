let armedSplitCheck = null;

export function armSplitCheck(state) {
  armedSplitCheck = {
    ...state,
    armedAt: new Date().toISOString(),
  };
  return armedSplitCheck;
}

export function getArmedSplitCheck() {
  return armedSplitCheck;
}

export function clearSplitCheckState() {
  armedSplitCheck = null;
}

export function isSplitCheckArmedFor(planPath) {
  return armedSplitCheck?.planPath === planPath;
}
