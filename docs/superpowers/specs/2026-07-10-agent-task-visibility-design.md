# Agent Task Visibility — Design (v1)

**Status:** approved design, pre-implementation
**Date:** 2026-07-10
**Package:** `@plane/agents` (scaffolded)
**Visual pre-draft:** https://claude.ai/code/artifact/1c0120b3-3e62-45df-acb9-d6d337204f69

## Goal

Give Plane users calm visibility into long-running, autonomous agent tasks — the
ability to watch, steer, interrupt, and review runs while they happen and after —
without the attention tax of toast spam or focus-stealing modals.

The agent runtime itself is **out of scope**: a separate backend (pre-supposed)
owns run lifecycle and orchestration. Our work observes that runtime over a
defined contract and sends it control commands. In tests we mock the contract.

## Non-goals (v1)

- Building or orchestrating the agents themselves.
- A fleet/Kanban board (belongs to high-concurrency; v1 expects few runs).
- Push / OS notifications and notification-budget logic.
- Agent targets other than **work items**.
- Plan-approval-before-run gate, checkpoints/rollback UI, best-of-N attempts.

These are recorded in [Backlog](#backlog) and are designed to compose on top of
v1 without reshaping its data.

## Principles (research-grounded)

Drawn from 2025–26 agent-UX research (Cursor, Copilot, Codex, Devin, Claude,
Replit, Windsurf, plus ambient-AI design writing):

1. **Match signal loudness to stakes.** Four layers — ambient (default) →
   progress (on demand) → attention (budgeted, decisions only) → summary (after).
   Only the attention layer interrupts. Over-notifying is worse than no status.
2. **Named status + steps, never a percent bar.** Convergent taxonomy:
   `queued → running → waiting_for_input / awaiting_approval → succeeded / failed
/ cancelled`. Determinate progress is a checklist of plan steps.
3. **Elevate the blocking state.** A run that needs the human ranks above all
   others in any list.
4. **Interrupt ≠ steer.** Splitting them is the single most-documented UX win.
   `cancel` is a hard terminal stop; `correct` injects guidance without killing
   the run (applied at the next tool boundary).
5. **Gate only the irreversible, inline.** Approval prompts appear in the run row,
   not as a modal.
6. **Completion is a quiet badge + a reviewable artifact**, not a popup.
7. **Reduced-motion-safe, calm.** One live pulse; honor `prefers-reduced-motion`;
   `role="status"` / `aria-live` on state changes.

## Architecture

Compartmentalized into a new workspace package, riding seams that already exist.

```
@plane/agents (new package — contracts + framework-agnostic logic + reducer)
   │  data + event + command types; IAgentService; IAgentEventTransport;
   │  pure state: applyEvent(state, event) reducer + reconcile helpers
   │  (no React / MobX / DOM — reusable by web AND a future native client)
   ▼
apps/web/ce/**  (wired via the existing @/plane-web CE/EE alias — no core edits)
   ├─ store/agents     MobX adapter — thin observable wrapper over the pure reducer
   ├─ services/agents  REST impl of IAgentService (list/get/sendCommand)
   ├─ transport/agents impl of IAgentEventTransport (subscribes to apps/live)
   └─ components/agents panel, run row, detail, inline work-item indicator
   ▼
apps/live  (existing Node + ws + Redis service)
   │  new lightweight authenticated agent-events channel (NOT Yjs):
   │  backend publishes run events → Redis pub/sub → live relays to subscribers
   ▼
backend (pre-supposed)  owns lifecycle; exposes REST for runs/commands +
                        publishes events to Redis
```

### Why `apps/live` and not Hocuspocus/Yjs

`apps/live` is the only existing real-time transport and already has `ws` +
`@hocuspocus/extension-redis`. We reuse the **service + Redis pub/sub**, but add a
plain event-relay channel rather than modeling agent events as a Yjs CRDT
document. Agent events are ephemeral, ordered, server→client broadcasts; forcing
them through a collaborative-document model would be friction for both this
feature and the editor's use of Yjs. This honors "reuse existing real-time
transport" without bending it out of shape.

### Client-agnostic core & durable state

Two forward-looking constraints shape the boundaries:

- **More than one client.** Web today; a native companion app is plausible later.
  So all reusable logic — the contract types, the `IAgentService` /
  `IAgentEventTransport` interfaces, and the **pure event→state reducer** — lives
  in `@plane/agents` with zero framework/DOM dependencies. Each client supplies
  only thin adapters: web = a MobX observable wrapper + `fetch`/SWR service +
  a `live`-WebSocket transport; a native client = its own store + platform HTTP +
  socket, reusing the identical reducer and interfaces.

- **The client holds no authoritative state.** It is a _projection_ of
  server-owned state, fully reconstructable from `listRuns` + the event stream.
  This makes local-state interruptions — browser refresh, device reboot, app
  close/reopen, tab backgrounding, network drop — non-events: on every (re)mount,
  reconnect, or tab-visible, the client takes a fresh authoritative snapshot,
  then resumes the stream and reconciles by `sequence`. **We do not persist run
  state locally as a source of truth.** (An optional last-seen `sequence` per run
  may be cached purely as a hint to detect missed events; the snapshot refetch is
  what guarantees correctness.) Cold start after a reboot is therefore just the
  normal load path.

### The contract (`@plane/agents`, provisional, scaffolded)

- **Data** (`types/session.ts`): `TAgentRun` (id, agentKey, title, status,
  workspaceId, projectId?, `target`, initiatedBy, progress?, steps?, result?,
  error?, timestamps), `TAgentRunStatus`, `TAgentStep`, `TAgentTarget`,
  `AGENT_TERMINAL_STATUSES`, `AGENT_BLOCKED_STATUSES`.
- **Events** (`types/events.ts`): `TAgentEvent` envelope with per-run monotonic
  `sequence` for gap detection + reconnect reconcile. Types: `status_changed`,
  `progress`, `step_*`, `input_requested`, `approval_requested`, `completed`,
  `error`.
- **Commands** (`types/commands.ts`): `TAgentCommand` — `cancel`, `pause`,
  `resume`, `correct`, `provide_input`, `approve`, `reject`, `retry`.
- **Interfaces**: `IAgentService` (listRuns / getRun / sendCommand),
  `IAgentEventTransport` (subscribe → unsubscribe handle).
- **State (v1, to build)**: `state/reducer.ts` — pure `applyEvent(state, event)`
  and `reconcile(state, snapshot)`; the shared, framework-neutral brain each
  client wraps in its own store.

Field names + status set are provisional and may firm up during implementation;
consumers treat unknown status values defensively.

## Data flow

1. **Load / (re)hydrate** — `IAgentService.listRuns({ workspaceId, target? })` and
   `getRun` take an authoritative snapshot into the reducer state (SWR). Reconcile
   is idempotent by run `id`. This same path runs on first mount **and** on every
   recovery trigger — reconnect, tab-visible (`visibilitychange`), app resume —
   so refresh / reboot / app-close need no special handling.
2. **Live** — on panel open, and for the currently-viewed work item, the
   transport `subscribe`s. Events apply through the pure reducer in `sequence`
   order; a gap (or a stale snapshot) triggers a `getRun` refetch to reconcile.
3. **Control** — UI emits `IAgentService.sendCommand`. The store reflects the
   resulting state only when the backend echoes it back as an event (no optimistic
   terminal transitions for irreversible commands).

## UI (hybrid, thin)

**Ambient (layer 1):** a header pip + count. Pulse only while ≥1 run is active;
reduced-motion → static. No action implied.

**Global panel (layer 2):** a non-modal drawer opened from the pip. Master list
grouped in priority order: **Needs you** (blocked) → **Running** → **Queued** →
**Recently done**. Each row: agent title, status chip (named), target link, and —
for running — a step meter + "step N of M". Click → detail: step timeline
(collapsed-by-default log), result/error, and controls.

**Inline indicator (hybrid reach):** on the work-item detail view, a compact chip
for active run(s) on that item, deep-linking into the panel/detail. This is the
only inline surface in v1.

**Controls, inline, never modal:**

- Running → **Pause** (`pause`, resumable — the non-destructive default) plus a
  **steer** input (`correct`) in detail. Hard **Cancel** (`cancel`) is a
  _secondary_ action, not the one-tap default (see recovery below).
- Paused → **Resume** (`resume`) or **Cancel run**.
- `awaiting_approval` → **Approve** / **Reject** in the row; irreversible actions
  flagged.
- `waiting_for_input` → inline prompt + reply (`provide_input`).
- `failed` → **Retry** (`retry`).
- `succeeded` → **Review changes** (opens `result.reviewUrl`).

**Completion:** quiet — the row moves to "Recently done" with a badge. No toast.

## Error / edge handling

- **Transport disconnect** → `onStatusChange(false)`; UI shows a subtle
  "reconnecting" state on the panel, keeps last-known run states. On reconnect,
  refetch visible runs and resume the event stream; `sequence` gaps drive
  per-run reconcile.
- **Out-of-order / duplicate events** → store applies strictly by `sequence`;
  older or duplicate sequences are ignored.
- **Command failure** (network / rejected) → inline, non-blocking error on the
  control with a retry affordance; run state unchanged until the backend confirms.
- **Unknown status / event type** → rendered defensively (generic chip; event
  ignored) so a backend that runs ahead of the client never breaks the panel.
- **Terminal runs** receive no further updates; the store stops subscribing to
  them.
- **Accidental stop is recoverable.** The one-tap default is **Pause**
  (resumable), not Cancel — so the common misclick suspends the run (agent keeps
  its context/checkpoint) and recovery is a one-tap **Resume**. Hard **Cancel** is
  a deliberate secondary action whose dispatch is **deferred ~5s behind an inline
  Undo**: undo means the command is never sent and the agent never stopped. The
  cancelled row is a client-local _pending_ state during the window, reconciled by
  the real terminal event once dispatched. (A backend soft-`cancelling` state is
  the more refresh-robust variant → backlog.)

## Scale, resilience & performance

This feature changes Plane's real-time profile: editor collab opens a socket
_per open document_, but naive agent visibility would open one _per logged-in
user_. The design bounds that deliberately.

### Bounding concurrent connections (the key decision)

- **Lazy, on-demand subscription.** A client opens the agent socket **only when
  it is actually watching** — the panel is open, or the user is viewing a work
  item that has an active run. When nothing is watchable, there is **no socket**.
  Steady-state concurrent connections ≈ users engaging with agents, not all
  users online.
- **Ambient count without a socket.** The header pip's count comes from a cheap
  aggregate poll (revalidate-on-focus, ~30–60s) — not a live stream. The
  expensive channel is reserved for active watching.
- **One multiplexed socket per client.** A single connection carries all of a
  client's subscriptions; `subscribe` / `unsubscribe` are messages on it, not new
  sockets per run. (Cross-tab sharing via SharedWorker → backlog.)

### Traffic volume

- **Server-side coalescing** (requirement on the `live` relay / backend): rapid
  `progress` / `step_updated` events collapse to the latest per run at a capped
  cadence (≤1–2/s). Milestone events (`status_changed`, `approval_requested`,
  `input_requested`, `completed`, `error`) are **never dropped**.
- **Watched-runs only.** The stream carries events for runs the client is
  actually showing, not every workspace run.
- **Delta payloads.** Events are small envelopes (already the contract); full
  step history / logs are fetched on expand, not pushed.
- **Backpressure-safe.** Dropping coalesced progress is harmless — the reducer is
  idempotent and the snapshot refetch reconciles any gap.

### Crash isolation (never take down the host app)

- **Error boundaries** wrap both agent surfaces — the global panel and the inline
  work-item indicator — so a render error degrades to a local "Agents
  unavailable" fallback, never a white-screen. Extends the existing
  `apps/web/app/root.tsx` error-boundary pattern (React Router v7) down to the
  component level.
- **Transport isolation.** WebSocket and parse errors are caught inside the
  transport adapter and surfaced via `onStatusChange` / a subtle panel state —
  **never thrown into React**. The pure reducer is _total_: unknown event types
  and malformed payloads are ignored (and logged), so a backend running ahead of
  the client cannot crash it.
- **Kill switch.** The whole surface sits behind a feature flag so it can be
  disabled without a redeploy if it misbehaves at scale.
- **Service failures** (REST) are caught, surfaced inline, and stay feature-local.

### Feature flagging & safe rollout

Assuming a flag primitive exists, this feature is deliberately easy to gate — and
"off" is byte-for-byte today's behavior, because nothing in core is modified
(all code enters through the `@/plane-web` CE alias and mounts at just three
surfaces: header pip, global panel, inline work-item indicator).

- **Gate before any connection.** The flag is evaluated _before_ the transport
  subscribes or the ambient poll starts — so flag-off guarantees **zero network
  footprint** (no sockets, no polls), not merely a hidden UI.
- **Lazy-load behind the gate.** The agents bundle is dynamically imported only
  when the flag is on. Off → the code never loads: no runtime cost, and no bug in
  agent code can execute.
- **Granularity maps to the three lanes:** whole-surface kill switch (no mount);
  transport-off degrade to Pull-only REST (if `live` misbehaves); read-only
  (render runs, disable Commands).
- **Small blast radius when off.** Client holds no authoritative state (removing
  it can't corrupt anything), no core edits, lazy connections, and the error
  boundary isolates unforeseen crashes — so even partial rollback is safe.
- **Progressive rollout / instant rollback.** Flag keyed by workspace / user /
  %-cohort. Because the backend is source of truth and the client is a projection,
  enabling a cohort needs no migration or data change; rollback is a flip, and
  anyone still enabled rebuilds state from the server.
- **Runtime kill.** If the flag is remote-evaluated, disable mid-incident without
  a redeploy — the gate re-evaluates on next render / next subscribe. Manual kill
  (flag) and automatic kill (error boundary fallback) are independent paths.

### Connection lifecycle hygiene

- Tear down socket + subscriptions on panel close, navigation away from a watched
  entity, tab hidden past a short grace period (`visibilitychange`), and unmount —
  preventing connection leaks.
- Heartbeat/ping to detect dead sockets; the relay idle-times-out abandoned
  subscriptions.
- Reconnect with **capped exponential backoff + jitter** to avoid a thundering
  herd when the `live` service restarts; after N failures, degrade to last-known
  state + a manual/periodic snapshot refetch.

### Server capacity (largely the infra owner's, but our model respects it)

- `apps/live` already runs Redis pub/sub (`apps/live/src/redis.ts`,
  `@hocuspocus/extension-redis`); the relay uses a **per-workspace channel** and
  fans out only to instances with subscribers. Horizontal scale needs a
  WS-aware LB (sticky or Redis-backed).
- Auth per `subscribe` (workspace membership); cap subscriptions per connection.
- Our contract must **not assume a single `live` instance** — `sequence`-based
  reconcile already tolerates cross-instance gaps and reconnects.

### Client render cost

- MobX fine-grained observers → only changed rows re-render; throttled reducer
  application.
- Step logs collapsed by default (not rendered until expanded).
- List virtualization is **not** needed for v1 (work-item-scoped keeps counts
  low); revisit with the fleet board → backlog.

### v1 vs. later

**In v1** (cheap, and mostly correctness/safety rather than features): lazy
on-demand subscription, ambient-count poll, single multiplexed socket, error
boundaries, transport isolation + total reducer, feature-flag kill switch,
lifecycle teardown, reconnect backoff. Server-side coalescing is a stated
requirement on the backend/relay.

**Backlog:** SharedWorker cross-tab socket sharing, list virtualization, and the
horizontal `live` scaling / LB work (infra owner).

## Testing

- **Contract mocks:** `IAgentService` and `IAgentEventTransport` are mocked; no
  live runtime needed.
- **Reducer reconciliation** (highest-value tests — live in `@plane/agents`,
  platform-neutral, no web harness): in-order apply; out-of-order + duplicate
  `sequence`; gap → refetch; snapshot-rehydrate after simulated
  refresh/reconnect; terminal freeze; unknown-status/event tolerance. Because the
  reducer is pure, these tests also cover the future native client.
- **Command emission:** each control emits the right `TAgentCommand`; no
  optimistic terminal transitions.
- **Component states:** panel groupings and each run state via stories
  (`@plane/propel` / `@plane/ui`), including reduced-motion and empty/idle.
- **Resilience:** transport errors surface via `onStatusChange` rather than
  throwing; the error boundary renders its fallback when a child throws (host app
  survives); reconnect uses capped backoff + jitter; teardown on unmount /
  tab-hidden actually closes the socket; the feature flag hides the whole surface.

## Component / package reuse

- Progress step meter, status chips → `@plane/propel/badge`, `/pill`, custom
  step meter; spinners/skeletons from `@plane/propel`.
- Panel container → `@plane/propel/scrollarea` + `/card`; collapsible log →
  `/collapsible`.
- Detail timeline modeled on `apps/web/core/components/issues/issue-detail/
issue-activity/` and `common/activity/`.
- Tokens from `@plane/tailwind-config` (`variables.css`).

## Backlog (compose on top of v1)

- Push / OS notifications for the three moments (needs-input, done, failed) +
  notification-budget (3–5/day) logic and a quiet inbox integration.
- Fleet/Kanban board for high concurrency; grouping, filtering, time-grouping.
- Additional agent targets: cycles, pages, projects, workspace-level.
- Plan-approval-before-run gate; checkpoints / rollback UI; best-of-N attempts.
- Full agent-activity history page; digests / batching.
- Optimistic UI for reversible commands.
- SharedWorker cross-tab socket sharing; run-list virtualization.
- Horizontal `apps/live` scaling + WS-aware load balancing (infra owner).

## Confirmed assumptions

Reviewed and accepted (2026-07-10):

- v1 targets **work items only** (broaden later — backlog).
- Backend exposes REST for `listRuns` / `getRun` / `sendCommand`, publishes events
  to Redis in the `TAgentEvent` shape, and performs server-side coalescing of
  high-frequency progress events.
- Extending `apps/live` with a dedicated (non-Yjs) agent-events channel is the
  transport, vs. standing up a new service.
