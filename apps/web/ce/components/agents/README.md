<!--
Copyright (c) 2023-present Plane Software, Inc. and contributors
SPDX-License-Identifier: AGPL-3.0-only
See the LICENSE file for details.
-->

# Agents — UI components

The **visible** agent-visibility surface: an ambient header pip that opens a
non-modal drawer listing agent runs, their live status, and the inline controls
to steer them. These components are presentation only — they read
`store.grouped` (an observable projection) and dispatch through
`store.runCommand`; all state logic lives in the [web adapter
layer](../../README.agents.md) and the framework-free
[`@plane/agents`](../../../../packages/agents/src/state/README.md) core.

For the wider design (four-layer status model, recovery model, feature-flag
rollout) see
[`docs/superpowers/specs/2026-07-10-agent-task-visibility-design.md`](../../../../docs/superpowers/specs/2026-07-10-agent-task-visibility-design.md)
— especially the "UI (hybrid, thin)", "Error / edge handling", and "Feature
flagging & safe rollout" sections.

## Component map

| File                         | Role                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `status-presentation.ts`     | Pure `status → { label, tone }`. UI-agnostic (no colors) so the mapping stays testable.              |
| `agent-status-chip.tsx`      | Renders a tone as a theme-aware label chip via Plane's `--color-label-*` vars (adapts to app theme). |
| `agent-run-row.tsx`          | One master-list row: title, chip, target, `step N of M`, and the recovery-model controls.            |
| `agents-panel.tsx`           | The drawer body: grouped master list + live subscription while open.                                 |
| `agent-run-detail.tsx`       | Detail view: step timeline + steer / provide-input / approve controls.                               |
| `agent-inline-indicator.tsx` | Hybrid reach: a compact per-work-item chip that deep-links into the panel.                           |
| `agents-header-pip.tsx`      | Ambient tier: a quiet pip + active count; pulses only while runs are live.                           |
| `agents-error-boundary.tsx`  | Crash isolation: degrades to a local fallback instead of white-screening the host app.               |
| `agents-root.tsx`            | Entry point: flag gate + lazy-loaded panel, mounted in the workspace header.                         |

The recovery-model deferral is owned by
[`hooks/agents/use-deferred-cancel.ts`](../../hooks/agents/use-deferred-cancel.ts).

## How they compose

```
AgentsRoot (flag gate)
 └─ AgentsErrorBoundary
     ├─ AgentsHeaderPip            ← ambient pip + count
     └─ (lazy) AgentsPanel         ← drawer, mounted only when opened
         └─ AgentRunRow[]          ← grouped master list
             └─ AgentStatusChip    ← statusPresentation() → tone → theme var
                                   AgentRunDetail → step timeline + steer/approve

AgentInlineIndicator               ← separate hybrid entry from a work item
```

- **Master–detail + grouped priority.** The panel is the master list; a row
  click opens `AgentRunDetail`. Rows are grouped **Needs you** (blocked) →
  Running → Queued → Recently done, and that order is deliberate: the blocking
  "Needs you" group is pinned first so the human-blocking work is always on top.
- **Status is named + step text, never a percent bar** (a design decision):
  `statusPresentation` yields a named label/tone, and running rows show
  `step N of M`.
- **Observability.** Rows and panel are MobX `observer`s. The store holds the
  projection as a single `observable.ref`, so a state swap replaces that ref and
  re-renders the observers — hence they must be observers, not plain components.

## Recovery model

Accidental stops are recoverable, so the destructive path is guarded:

- **Pause** is the non-destructive, one-tap default for a running run (resumable
  via **Resume** — the agent keeps its context/checkpoint).
- Hard **Cancel** is a secondary action. It is **deferred ~5s behind an inline
  Undo** by `useDeferredCancel`: while pending, the row shows "Undo stop"; if
  undone, the `cancel` command is **never sent** and the agent never stopped.

## Mount story: flag-gated, lazy, error-isolated

`AgentsRoot` evaluates the feature flag **before** any hook that opens a
socket/poll — flag-off returns `null`, so it is byte-for-byte today's behavior
with **zero network footprint**. The panel bundle is `lazy`-imported, so its
code isn't fetched until the flag is on and the drawer is opened. The whole
surface is wrapped in `AgentsErrorBoundary`, so a render crash in the agents UI
degrades to a local "Agents unavailable" fallback rather than taking down the
host app.
