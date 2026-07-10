# Agent state core

The framework-free **projection** core for agent runs. The client holds **no
authoritative agent state** — what lives here is a projection of server-owned
state, fully rebuildable from `listRuns` (an authoritative snapshot) plus the
per-run event stream. There is no React, MobX, or DOM here, so the web client
and a future native client can wrap the **same** functions, each supplying only
a thin store/transport adapter.

See the design doc for the wider picture:
[`docs/superpowers/specs/2026-07-10-agent-task-visibility-design.md`](../../../../docs/superpowers/specs/2026-07-10-agent-task-visibility-design.md)
("Client-agnostic core & durable state").

## Mechanism

- **`types.ts` — `TAgentCollectionState`**: `runs` (by id) plus `lastSequence`
  (highest applied event `sequence` per run id, for gap detection).
  `emptyAgentState()` seeds it.
- **`reducer.ts` — `applyEvent(state, event)`**: applies one event in
  `sequence` order, total, immutable. **`reconcile(state, snapshot)`**: rehydrates
  from an authoritative snapshot (the durability path) and resets `lastSequence`
  so the next streamed event applies cleanly.
- **`selectors.ts`**: derive the panel's view — `selectGroupedRuns` (blocked /
  running / queued / done, in panel priority order), `selectActiveCount`,
  `selectRunsForTarget`.
- **`backoff.ts` — `backoffDelay(attempt)`**: pure, capped exponential reconnect
  timing. Jitter is the caller's job, kept out here so the function stays
  deterministic and testable.

### Data flow

```
snapshot ──reconcile──▶ state ──applyEvent(live events)──▶ state ──selectors──▶ UI
```

On first mount and on every recovery trigger (reconnect, tab-visible, app
resume) the client takes a fresh snapshot, `reconcile`s it, then resumes the
stream through `applyEvent`.

## Invariants

- **Ordered by sequence** — events apply strictly in monotonic per-run
  `sequence` order; stale or duplicate sequences are idempotent no-ops, so
  replays across a reconnect are safe.
- **Total / never throws** — events for unknown run ids and unknown event types
  are ignored, not thrown, so a backend running ahead of the client can't crash
  the UI.
- **Immutable** — every transition returns new objects, so memoized selectors
  and store observers detect changes.
- **Client not authoritative** — local state is a projection only; refresh,
  reboot, and reconnect rebuild from the server snapshot.
