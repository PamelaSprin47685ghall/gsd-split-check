# gsd-split-check

A small GSD extension that turns `execute-task` into a split-check gate before implementation begins.

## Runtime flow

1. `before_agent_start` looks for the `## UNIT: Execute Task ...` header in the current turn.
2. If the target task plan does not yet contain `split_check_done: true`, the extension arms the turn and appends a focused split-check system prompt.
3. `agent_end` reads the assistant response, looking for `split_needed: true|false` plus an optional `split_plan` JSON block.
4. If a split is needed, the extension assigns task IDs, calls the host workflow MCP tool `gsd_plan_slice` directly, and then writes `split_check_done: true` into the task plan frontmatter.
5. If no split is needed, the extension only writes `split_check_done: true` into the task plan frontmatter.

## What it persists

The extension keeps only a transient in-memory turn state while a split-check is active. The durable signal is the task plan frontmatter, which becomes the source of truth after the check passes.

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

- Split only after the split-check step says the task should be split.
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

## Project layout

- `index.js` — package entry point that re-exports the extension
- `src/extension.js` — hook registration and turn lifecycle wiring
- `src/frontmatter.js` — task plan frontmatter helpers
- `src/prompt.js` — split-check prompt builder and completion detection
- `src/state.js` — transient turn state
- `src/unit.js` — `execute-task` prompt parser and plan-path resolver
- `src/task-plan.js` — plan file I/O
- `test/` — node:test coverage for parser, persistence, and lifecycle hooks

## Development

```bash
npm test
```
