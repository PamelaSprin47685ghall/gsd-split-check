# gsd-split-check

Standalone GSD split-check extension.

## What it does

This extension pauses `execute-task` turns and asks the agent to decide whether the current task should be decomposed into a smaller sub-DAG first.

If the assistant returns `split_check_done: true`, the extension marks the task plan as checked and lets the task continue on the next turn.

## Workflow

- `before_agent_start` inspects the current task plan.
- If the task has not been split-checked yet, the extension injects a split-check prompt.
- `agent_end` looks for `split_check_done: true` in the assistant response.
- When the marker is present, the extension updates the task plan frontmatter.

## Split model

Use the original task as the integration-check node, not as a throwaway parent.

```text
E1: "Implement user system"
  -> E2: "Implement auth middleware"   deps: []
  -> E3: "Implement login page"         deps: [E2]
  -> E4: "Implement registration page"  deps: []
  -> E1: integration check               deps: [E2, E3, E4]
```

Rules:

- Spawn sub-tasks only after the split-check step says the task should be split.
- Sub-tasks may declare dependencies on each other.
- The original task stays in place and comes back as the final integration check.
- Once all sub-tasks are complete, the original task runs again to verify the combined result.
- The integration check may itself be split again if the scope still looks too large.

## Install

Install from the GitHub repo URL:

```bash
gsd install https://github.com/PamelaSprin47685ghall/gsd-split-check
```

Or install from a local checkout:

```bash
gsd install /home/kunweiz/Desktop/gsd-split-check
```

## Layout

- `index.js` — extension entry point
- `package.json` — package metadata and pi manifest
- `README.md` — usage and install notes
- `LICENSE` — MIT license
