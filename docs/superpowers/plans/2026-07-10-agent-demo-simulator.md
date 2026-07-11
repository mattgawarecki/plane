# Agent-Activity Demo Simulator — Plan (v1)

**Status:** plan, pre-implementation
**Date:** 2026-07-10
**Relationship:** demo-only companion to the [Agent Task Visibility design](../specs/2026-07-10-agent-task-visibility-design.md) and its [implementation plan](./2026-07-10-agent-task-visibility.md). Reuses the `@plane/agents` contract (`TAgentRun` / `TAgentEvent` / `TAgentCommand`) as its output shape.
**Target:** LOCAL dev only. Web `http://localhost:3000`, API `http://localhost:8000`, workspace slug `klarity`.

> **⚠️ Implementation status (updated 2026-07-10):** This scripted-simulator plan was **superseded** during implementation — read the sections below as historical design. The shipped `@plane/agents-demo` package is a **real-LLM runtime** (Anthropic Tool Runner over `claude-opus-4-8` — `packages/agents-demo/src/runtime/dispatch.ts` · `tools.ts`), not the deterministic, no-LLM scenario engine described here (see `../specs/2026-07-10-agentic-demo-system-design.md`). Two premises below are now stale: (1) **the runs backend now exists** — `packages/agents-demo/src/server.ts` is a `node:http` bridge on `:4000` serving exactly `GET/POST /api/workspaces/:ws/agent-runs/…` and `POST /dispatch` (so O2 is **resolved**); (2) **transport is HTTP polling**, not the `apps/live` / `ws-mock` channel — the web panel polls the bridge every 2500ms (`apps/web/ce/components/agents/agents-panel.tsx:32`). The `apps/live` agent-events relay was never built; the `WebSocket` transport that does exist is dormant (`useAgentSubscription({ enabled: false })`).

---

## 1. Goal & non-goals

### Goal

A standalone, demo-only tool that **spontaneously creates and manipulates real Plane work items over the REST API** so that, on screen, it looks like an autonomous agent is doing believable knowledge work — task decomposition, triage, dependency reasoning, progress orchestration, rollups, housekeeping. It is the centerpiece of a demo showing "what an agentic Plane could look like."

It does two things at once:

1. **Drives real Plane data** (issues, states, labels, comments, cycles, modules, relations) via the public token API, on a watchable cadence.
2. **Emits an agent-run journal** shaped as `@plane/agents` `TAgentRun` + `TAgentEvent` values, so the same activity can later feed the real Agents visibility panel (via a mock transport or the future `apps/live` channel).

### Non-goals

- Not a real agent runtime. No LLM calls, no reasoning engine — behaviors are scripted, deterministic scenarios with humanized copy.
- Not shipped. Never imported by `apps/web`, never built into any bundle, never published.
- Does not implement the visibility UI (that is the sibling plan). It only _produces data the UI would render_.
- Does not touch production. Hard-refuses any non-localhost host (see §7).
- No new backend endpoints. It uses only the existing public REST API that the repo already implements.

---

## 2. Confirmed API surface (verified first-hand in the repo)

All paths below were read directly from `apps/api/plane/api/urls/` and `apps/api/plane/api/serializers/issue.py`. The public REST API is the right substrate for a script: it is token-authenticated and purpose-built for external automation, unlike the internal `/api/*` app API which is session/cookie-based.

**Base + auth**

- Public API mounted at **`/api/v1/`** — `apps/api/plane/urls.py:21` (`path("api/v1/", include("plane.api.urls"))`).
- Auth header: **`X-Api-Key: <token>`** — `apps/api/plane/api/middleware/api_authentication.py:24` (`auth_header_name = "X-Api-Key"`), also `apps/api/plane/api/views/base.py:64`.
- Local API base default: **`http://localhost:8000`** — `apps/web/.env.example:1` (`VITE_API_BASE_URL="http://localhost:8000"`).
- Token generation (operator step): create a Personal API token in the web UI (Profile/Workspace Settings → API tokens; backend `apps/api/plane/app/urls/api.py` `users/api-tokens/`).

**Work items (issues)** — new `work-items` URL prefix (`apps/api/plane/api/urls/work_item.py`, `new_url_patterns`):

| Action                             | Method + path (prefix `/api/v1`)                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| List / create                      | `GET`/`POST` `/workspaces/{slug}/projects/{project_id}/work-items/`                      |
| Retrieve / update / delete         | `GET`/`PATCH`/`DELETE` `/workspaces/{slug}/projects/{project_id}/work-items/{id}/`       |
| Get by identifier (e.g. `KLAR-12`) | `GET` `/workspaces/{slug}/work-items/{project_identifier}-{seq}/`                        |
| Search                             | `GET` `/workspaces/{slug}/work-items/search/`                                            |
| Links (external URLs)              | `GET`/`POST` `/workspaces/{slug}/projects/{project_id}/work-items/{issue_id}/links/`     |
| Comments                           | `GET`/`POST` `/workspaces/{slug}/projects/{project_id}/work-items/{issue_id}/comments/`  |
| Activities (read)                  | `GET` `/workspaces/{slug}/projects/{project_id}/work-items/{issue_id}/activities/`       |
| Relations                          | `GET`/`POST` `/workspaces/{slug}/projects/{project_id}/work-items/{issue_id}/relations/` |

**Issue payload fields** (from `IssueSerializer`, `apps/api/plane/api/serializers/issue.py:46–150`):

- `name` (string, required), `description_html` (rich text HTML; sanitized via `validate_html_content` — use a safe subset: `<p>`, `<ul>`, `<li>`, `<strong>`, `<h3>`, etc.)
- `state` — a **state UUID** (validated against project states, line 123)
- `parent` — a **parent issue UUID** for sub-issues (line 130); there is no separate "create sub-issue" endpoint — you set `parent` on a normal create.
- `assignees` — **list of member user UUIDs** (validated as project members, line 107)
- `labels` — **list of label UUIDs** (validated as project labels, line 116)
- `priority` — one of `urgent` | `high` | `medium` | `low` | `none` (`apps/api/plane/db/models/issue.py:106`)
- `estimate_point` — an **estimate-point UUID** (requires an estimate configured on the project, line 140)
- `start_date`, `target_date` (ISO dates; `start_date` must be ≤ `target_date`)

**States** (`state.py`): `GET`/`POST` `/workspaces/{slug}/projects/{project_id}/states/`, detail `/states/{state_id}/`. Each state has a **`group`** in `backlog` | `unstarted` | `started` | `completed` | `cancelled` — the simulator resolves states by group to move work "across the board."

**Labels** (`label.py`): `GET`/`POST` `/.../labels/`, detail `/.../labels/{id}/`.

**Comments**: body field **`comment_html`** (sanitized), plus `access` (`INTERNAL`/`EXTERNAL`) — `issue.py:702`.

**Relations** (`IssueRelationCreateSerializer`, `issue.py:532–560`): `POST` `/.../work-items/{issue_id}/relations/` with body `{ "relation_type": <t>, "issues": [<uuid>, …] }`; `relation_type` ∈ **`blocking` | `blocked_by` | `duplicate` | `relates_to`** (plus `start_before` | `start_after` | `finish_before` | `finish_after` for scheduling relations). Note `blocking`/`start_after`/`finish_after` are stored reversed server-side. Remove uses `related_issue` (UUID).

**Cycles** (`cycle.py`): `GET`/`POST` `/.../cycles/`, detail `/.../cycles/{id}/`. Add issues: `POST` `/.../cycles/{cycle_id}/cycle-issues/` with body **`{ "issues": [<uuid>, …] }`** (confirmed `CycleIssueRequestSerializer`, `apps/api/plane/api/serializers/cycle.py:176`); remove: `DELETE` `/.../cycles/{cycle_id}/cycle-issues/{issue_id}/`. Transfer to another cycle: `POST` `/.../cycles/{cycle_id}/transfer-issues/` body `{ "new_cycle_id": <uuid> }`.

**Modules** (`module.py`): `GET`/`POST` `/.../modules/`, detail `/.../modules/{id}/`. Add issues: `POST` `/.../modules/{module_id}/module-issues/` with body **`{ "issues": [<uuid>, …] }`** (confirmed `apps/api/plane/api/views/module.py:668`); remove: `DELETE` `/.../modules/{module_id}/module-issues/{issue_id}/`.

**Members** (`member.py`): `GET` `/.../projects/{project_id}/members/` — used to resolve assignee UUIDs by name for the triage/routing scenarios.

**Estimates** (`estimate.py`): project estimate `/.../estimates/`; points `/.../estimates/{estimate_id}/estimate-points/`. An estimate point's value field is **`value`** (max 20 chars, `serializers/estimate.py:25`).

---

## 3. Architecture

### Where the code lives — recommendation: a private workspace package `packages/agents-demo`

Repo conventions (checked in `pnpm-workspace.yaml`, `packages/*`): every tool is a workspace package under `packages/*`; there is **no `scripts/` directory**. There is direct precedent for a _private, non-shipped tooling package_: **`@plane/codemods`** (`packages/codemods/package.json`) is `"private": true`, has **no `build` script and no `dist`/`exports`**, ships nothing, and is run via its own CLI-style scripts + `vitest`. That is exactly the shape we want.

**Decision:** create `packages/agents-demo` (`@plane/agents-demo`), modeled on `@plane/codemods`:

- `"private": true`, **no `build`/`exports`/`main`** → nothing can import it into a shipped bundle; it is invisible to `apps/web`.
- Because `pnpm-workspace.yaml` globs `packages/*`, it participates in the workspace (can `workspace:*`-depend on `@plane/agents` for contract types) without being a publish target.
- Run via `tsx` (dev dependency) — e.g. `pnpm --filter @plane/agents-demo sim run <scenario>`.

Rejected alternatives:

- A loose `scripts/` folder — no precedent in this repo; would sit outside the workspace and couldn't cleanly `workspace:*`-import `@plane/agents` types.
- Living inside `apps/web` — risks accidental bundling and violates the design's "no core edits / off is byte-for-byte today" property.

### Language / runtime

- **TypeScript on Node ≥ 22.18** (repo engine, `package.json` `engines`). Node 22 has global `fetch`, so the HTTP client needs **zero runtime deps**.
- Executed with **`tsx`** (dev dep). `vitest` for the pure-logic unit tests (scenario planners, guardrail, journal mapping), matching `@plane/codemods`.
- Lint/format via repo standard `oxlint` + `oxfmt`. SPDX header on every file.

### Should it reuse `@plane/services` `APIService`?

**No — use a thin token client.** `APIService` (`packages/services/src/api.service.ts`) is an axios wrapper built for the **internal app API** with cookie/session auth (`withCredentials`), browser interceptors, and the shipped web client's concerns. The simulator targets the **public `X-Api-Key` API** and runs in Node. A ~60-line `fetch` wrapper is simpler, dependency-free, and keeps the demo tool fully self-contained. We _do_ mirror `APIService`'s ergonomics (typed `get`/`post`/`patch`/`delete`, a base URL, injected auth header) so the code reads familiarly.

### Module layout

```
packages/agents-demo/
  package.json            # private, no build; scripts: "sim", "test"
  README.md               # operator quickstart (localhost only)
  src/
    cli.ts                # arg parsing → runner; --dry-run, --seed, --scenario, --speed
    config.ts             # env: PLANE_API_BASE, PLANE_API_TOKEN, PLANE_WORKSPACE, PLANE_PROJECT_ID
    guardrail.ts          # assertLocalhost(base) — pure, unit-tested (§7)
    client/
      plane-client.ts     # thin fetch wrapper, X-Api-Key header, dry-run aware
      resources.ts        # typed methods mapped to §2 endpoints (the "tiny API client", §4)
    engine/
      clock.ts            # pace(): staggered awaitable delays; --speed multiplier
      rng.ts              # seeded PRNG (mulberry32) for repeatable demos
      runner.ts           # loads a scenario, executes steps, emits journal + feed
      journal.ts          # maps steps → TAgentRun/TAgentEvent (§6)
      feed.ts             # optional emitters: console | file | ws-mock (§6)
      registry.ts         # names → scenario modules
      ledger.ts           # records created entity ids for idempotency + teardown (§7)
    scenarios/
      seed-world.ts       # ensure demo project, states, labels, people, cycle exist
      decompose-epic.ts
      triage-and-route.ts
      dependency-graph.ts
      progress-orchestration.ts
      cycle-rollup.ts
      housekeeping.ts
      wow-*.ts            # the delight moments (§8)
      teardown.ts
    scenarios/types.ts    # TScenario = { key, title, agentKey, plan(ctx): Step[] }
  tests/
    guardrail.spec.ts  journal.spec.ts  scenario-plan.spec.ts
```

**Separation of concerns that makes the demo trustworthy:** a scenario is a _pure planner_ — `plan(ctx) → Step[]` — that emits a list of intended actions with copy, targets, and delays but performs no I/O. The `runner` executes those steps through the `client` (real or dry-run) and simultaneously feeds the `journal`. This means every scenario is unit-testable without a server, and dry-run is "execute the plan, print, mutate nothing."

---

## 4. The tiny Plane API client (`client/resources.ts`)

A thin typed surface over §2. Every method funnels through `plane-client.ts`, which: (a) injects `X-Api-Key`, (b) prefixes `/api/v1`, (c) **no-ops writes and returns a synthetic id when `--dry-run`**, (d) records created ids in the `ledger`.

Methods the simulator needs, mapped to real endpoints:

| Method                                                                                                                          | Endpoint (verified §2)                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `listMembers()`                                                                                                                 | `GET /workspaces/{slug}/projects/{pid}/members/`                                          |
| `listStates()` / `resolveStateByGroup(group)`                                                                                   | `GET /.../states/` (pick by `group`)                                                      |
| `ensureLabel(name, color)`                                                                                                      | `GET`/`POST` `/.../labels/`                                                               |
| `createWorkItem({name, description_html, state, parent, assignees, labels, priority, estimate_point, start_date, target_date})` | `POST /.../work-items/`                                                                   |
| `getWorkItem(id)` / `getByIdentifier("KLAR-12")`                                                                                | `GET /.../work-items/{id}/` · `GET /workspaces/{slug}/work-items/{ident}/`                |
| `updateWorkItem(id, patch)`                                                                                                     | `PATCH /.../work-items/{id}/` (move state, reassign, set priority/estimate/dates)         |
| `deleteWorkItem(id)`                                                                                                            | `DELETE /.../work-items/{id}/`                                                            |
| `addComment(id, comment_html)`                                                                                                  | `POST /.../work-items/{id}/comments/`                                                     |
| `addLink(id, {title, url})`                                                                                                     | `POST /.../work-items/{id}/links/`                                                        |
| `relate(id, relation_type, issueIds[])`                                                                                         | `POST /.../work-items/{id}/relations/` (`blocking`/`blocked_by`/`duplicate`/`relates_to`) |
| `ensureCycle({name, start_date, end_date})`                                                                                     | `GET`/`POST` `/.../cycles/`                                                               |
| `addToCycle(cycleId, issueIds[])`                                                                                               | `POST /.../cycles/{cid}/cycle-issues/` body `{ issues:[…] }`                              |
| `ensureModule({name})` / `addToModule(moduleId, issueIds[])`                                                                    | `POST /.../modules/` · `POST /.../modules/{mid}/module-issues/` body `{issues:[…]}`       |
| `searchWorkItems(q)`                                                                                                            | `GET /workspaces/{slug}/work-items/search/`                                               |

The client also exposes `dryRun: boolean` and `speed: number` so scenarios stay agnostic.

---

## 5. Control surface & pacing

### Operator commands (CLI)

```
pnpm --filter @plane/agents-demo sim seed          # create demo project scaffolding (states, labels, people mapping, a cycle)
pnpm --filter @plane/agents-demo sim run <scenario> [--seed 42] [--speed 1] [--dry-run]
pnpm --filter @plane/agents-demo sim run all        # curated demo reel: runs a chosen sequence back-to-back
pnpm --filter @plane/agents-demo sim list           # list scenario keys + one-line descriptions
pnpm --filter @plane/agents-demo sim teardown [--yes]
```

Runtime controls (so it "demos well" — spontaneous but watchable):

- **Pause / resume / stop:** the runner watches for keypresses (`p` pause, `r` resume, `q` quit) and honors `SIGINT` — it finishes the in-flight API call, then halts at the next step boundary (never leaves a half-written relation). A stopped run flips its journal `TAgentRun` to `cancelled`.
- **Pacing (`engine/clock.ts`):** every step declares a `delayMs` (or a `delayRange` the seeded RNG samples). Defaults stagger actions over **2–8 s** with occasional **15–40 s "thinking" gaps**, so a viewer sees items appear one at a time, not a wall of instant writes. `--speed 2` halves all delays for dry-runs/rehearsal; `--speed 0.5` slows for a keynote.
- **Deterministic seeding (`engine/rng.ts`):** a seeded PRNG (mulberry32) drives every "choice" (which assignee, which delay in a range, which copy variant). `--seed 42` ⇒ byte-identical demo every time — critical for a rehearsed keynote. Same seed + same starting data = same sequence.

### Config (env, `config.ts`)

`PLANE_API_BASE` (default `http://localhost:8000`), `PLANE_API_TOKEN` (the `X-Api-Key`), `PLANE_WORKSPACE` (`klarity`), `PLANE_PROJECT_ID`. Missing token → hard error with a pointer to the settings page. `PLANE_API_BASE` is passed through the **localhost guardrail** (§7) before any request.

---

## 6. Mapping to the visibility contract (`@plane/agents`)

This is what ties the demo to the real feature. Each scenario run is modeled as **one `TAgentRun`**, and each API action (or small group) as a **`TAgentStep` + `TAgentEvent`s**. The `journal` produces exactly the shapes in `packages/agents/src/types/{session,events}.ts`, so the same stream could feed the real panel unchanged.

Mapping rules:

- **Run:** scenario start → `TAgentRun { id, agentKey: scenario.agentKey, title: scenario.title, status: "queued"→"running", workspaceId, projectId, target?, initiatedBy: "demo-operator", createdAt, ... }`. `target` points at the primary work item (e.g. the epic being decomposed) so the inline indicator lights up on that item.
- **Steps:** each planned step → a `TAgentStep { id, label, status: pending→running→succeeded }`. `label` is the human narration ("Drafting 5 sub-issues", "Assigning to Priya by load"). Emitted as `step_started` then `step_completed` events with a monotonic per-run `sequence`.
- **Progress:** `progress` events carry `{ currentStep, totalSteps }` so the panel's step meter fills as real issues appear.
- **Completion:** terminal step → `completed` event with `TAgentResult { summary, reviewUrl }` where `reviewUrl` deep-links to the created cycle/epic in the web UI (`http://localhost:3000/klarity/projects/{pid}/...`). Run status → `succeeded`.
- **Human-in-the-loop:** the approval scenario emits an `approval_requested` event (`TAgentApprovalRequest { approvalId, summary, irreversible }`) and sets status `awaiting_approval`; the runner then **blocks** until the operator answers (keypress `a` approve / `x` reject, or a matching `TAgentCommand`), demonstrating the gate. Approve → the gated API writes execute; reject → they're skipped and the run ends `cancelled` with a note.
- **Correlation:** the journal stores `{ runId → [created entity ids] }` alongside the ledger, so a viewer clicking a run in the panel can be deep-linked to the real items it produced.

**Feed sinks (`engine/feed.ts`)** — how the journal reaches a consumer, pick per demo:

1. `console` — pretty-prints the run/step/event stream (always on; good for narration).
2. `file` — appends NDJSON of `TAgentEvent`s to `./out/<runId>.ndjson` (replayable).
3. `ws-mock` — a tiny local WebSocket server that broadcasts the same `TAgentEvent` envelopes the future `apps/live` agent-events channel will carry. A dev build of the panel pointed at this socket would render the simulated run **live**, with zero UI changes. This is the bridge that makes "this simulator could later feed the real Agents panel" literally true.

> **Open question O2 — no runs backend exists yet. [RESOLVED 2026-07-10]** _At plan time_ the sibling plan's `AgentService` target `/api/workspaces/{ws}/agent-runs/…` was not implemented in the repo. It **now is**: `packages/agents-demo/src/server.ts` is an in-memory HTTP bridge on `:4000` serving those routes, which the web panel **polls** (no `ws-mock` / `apps/live` relay was built). The original text follows. ~~The sibling plan's `AgentService` targets `/api/workspaces/{ws}/agent-runs/…`, which **is not implemented in the repo** (the visibility backend is "pre-supposed"). So the simulator cannot POST runs to Plane; it _owns_ the run journal and exposes it via the feed sinks above. When the real backend + `apps/live` channel land, swap `ws-mock` for the real relay. Flagged, not invented.~~

---

## 7. Idempotency, cleanup & safety

### Localhost guardrail (hard, non-negotiable) — `guardrail.ts`

Before **any** network call, `assertLocalhost(PLANE_API_BASE)` runs. It parses the URL and throws unless the hostname is exactly `localhost`, `127.0.0.1`, `::1`, or `0.0.0.0`. Any other host (including `*.plane.so`, LAN IPs, tunnels) aborts the process with a clear message. This is a pure function with unit tests covering allow/deny cases. It is called from `config.ts` at load _and_ re-asserted in `plane-client.ts` on every request (defense in depth). There is no flag to disable it.

### Dry-run

`--dry-run` short-circuits every write in `plane-client.ts`: it logs the intended method + path + body, returns a synthetic UUID so downstream steps still "wire up," and **mutates nothing**. The journal/feed still emit, so you can rehearse the full narrative (including pacing and the approval gate) against a real-but-untouched instance, or with the server off entirely for the console/file sinks.

### Idempotency & re-runnability

- **Seed step** (`seed-world.ts`) is idempotent: states/labels/cycle/module are `ensure*` (look up by name, create only if absent). Safe to run repeatedly.
- **Tagging:** every entity the simulator creates is marked so it's identifiable and reversible — a dedicated **`agent-demo` label** on issues, and an `external_source: "agent-demo-sim"` + `external_id` (from the seeded RNG) where the serializer supports it, so re-runs detect and skip duplicates rather than piling up.
- **Ledger** (`engine/ledger.ts`): persists all created ids to `./out/ledger.json` keyed by run, so teardown works even in a fresh process.

### Teardown

`sim teardown` deletes everything the simulator created — from the ledger first, then a **belt-and-suspenders sweep** that lists work items carrying the `agent-demo` label and deletes them, plus the demo cycle/module/labels it made. Prompts for confirmation unless `--yes`. Teardown itself passes the localhost guardrail. It never deletes items lacking the demo marker.

### Blast radius

Runs only against a project you point it at (`PLANE_PROJECT_ID`); recommend a dedicated **"Agent Demo"** project so teardown can be aggressive. No writes outside that project/workspace.

---

## 8. The behavior catalog ("the magic")

Each scenario below lists: **trigger**, **API sequence** (real endpoints from §2), **timing**, **what the viewer sees**, **how it stays calm** (aligning with the design's four-layer, "needs-you-only-interrupts" principle), and its **contract mapping**. Copy is humanized and varies by seed.

### 8.1 Task decomposition — `decompose-epic`

- **Agent:** `decompose`. **Trigger:** operator seeds a vague epic ("Improve onboarding") as a single work item, or points the scenario at an existing one by identifier.
- **Sequence:** `getWorkItem(epic)` → post a short "reasoning" comment ("Breaking this into 5 scoped work items…") → create 5 child work items with `parent = epic`, each with a real `description_html` (context, **acceptance criteria** bullet list), a sensible `priority`, `estimate_point`, and `target_date` staggered to imply ordering → set the epic's state to `started`.
- **Timing:** one child every 3–6 s, a 10 s "thinking" gap before the first, so they cascade into the sub-issues list.
- **Viewer sees:** an empty epic sprouting a well-formed, ordered breakdown with crisp acceptance criteria — the single most legible "it understood the work" moment.
- **Stays calm:** all ambient — items just appear; the only surface that moves is the epic's sub-issue list and the run's step meter. No toast.
- **Contract:** `TAgentRun` targeted at the epic; steps = "Analyze epic", "Draft sub-issue N", "Order & estimate"; completes with `result.summary = "5 sub-issues created"` + `reviewUrl` to the epic.

### 8.2 Triage & routing — `triage-and-route`

- **Agent:** `triage`. **Trigger:** a fresh, unlabeled bug ("Login sometimes 500s") appears (operator creates it, or the scenario creates a raw one).
- **Sequence:** `searchWorkItems` for near-duplicates → if found, `relate(new, "duplicate", [existing])` and comment the link → set `priority` by keyword heuristics (auth/500 ⇒ `urgent`) → `ensureLabel("bug")`, `ensureLabel("area:auth")` and attach → `listMembers` and **assign by simulated load/expertise** (a seeded per-person load table picks the least-loaded auth owner) → comment a one-line rationale ("Routed to Priya — owns auth, lightest queue").
- **Timing:** dedup check (4 s) → label+severity (3 s) → assignment (5 s), each narrated.
- **Viewer sees:** a bare bug transform into a fully-triaged, assigned, de-duplicated ticket with a human-sounding rationale.
- **Stays calm:** ambient; the rationale is a _comment on the item_, not a notification.
- **Contract:** run targeted at the bug; steps "Check duplicates", "Set severity + labels", "Route to owner".

### 8.3 Dependency reasoning — `dependency-graph`

- **Agent:** `plan`. **Trigger:** a set of related work items exist (e.g. from 8.1) that have implicit ordering.
- **Sequence:** create/confirm ~4 items → wire a small graph with `relate(..., "blocked_by", [...])` (e.g. "Ship SSO" blocked_by "Provision IdP", which blocks "Migrate users") → `ensureCycle` → `addToCycle` in dependency order → set `start_date`/`target_date` to respect the chain → comment a plain-language critical-path note.
- **Timing:** relations 3 s apart; cycle assembly after a 12 s "sequencing" gap.
- **Viewer sees:** blockers light up on the items and a cycle fills in an order that visibly respects the dependencies — "it sequenced the sprint."
- **Stays calm:** ambient; the blocker chips are the payoff, no interrupt.
- **Contract:** steps "Infer dependencies", "Wire blockers", "Sequence cycle"; `reviewUrl` → the cycle.

### 8.4 Progress orchestration — `progress-orchestration`

- **Agent:** `execute`. **Trigger:** a cycle of active items exists.
- **Sequence:** loop over items, moving each `unstarted → started → completed` via `updateWorkItem(state=…)` over time, posting a short first-person "reasoning" comment at each transition ("Tests green, merging — moving to Done"). Occasionally flips one to `blocked`-style state and posts a hurdle, then clears it.
- **Timing:** the flagship "watchable" scenario — one transition every 20–45 s so the board visibly progresses during a talk. `--speed` tunes it to the segment length.
- **Viewer sees:** a Kanban board that moves itself, with a believable narration trail, as if an agent is doing the work.
- **Stays calm:** each move is ambient; only the _summary_ at the end (8.5) is a "summary layer" artifact. No per-move toast.
- **Contract:** a long-running `TAgentRun` emitting steady `progress` + `step_completed` events — ideal for exercising the panel's live step meter and coalescing.

### 8.5 Summarization / rollup — `cycle-rollup`

- **Agent:** `summarize`. **Trigger:** end of 8.4, or on demand for a noisy item.
- **Sequence (two flavors):** (a) **Cycle summary** — read cycle items + their states, compose a crisp `comment_html` rollup ("8 done, 2 carried over, 1 blocked on IdP — on track") on a summary item or the cycle's anchor item. (b) **Thread fold** — read a noisy comment thread on one item and rewrite the item's `description_html` into a tight, structured summary, then comment "Folded 14 comments into the description."
- **Timing:** a single deliberate 6–10 s "composing" beat, then the summary lands.
- **Viewer sees:** sprawling activity collapsing into one clear, well-formatted summary — the "it read everything and gave me the gist" moment.
- **Stays calm:** this is the design's **summary layer** — quiet, after-the-fact, reviewable, never an interrupt.
- **Contract:** short run; `result.summary` is the rollup's first line; `reviewUrl` → the summarized entity.

### 8.6 Housekeeping — `housekeeping`

- **Agent:** `tidy`. **Trigger:** on demand ("tidy the sprint").
- **Sequence:** `searchWorkItems`/list to find **stale** items (old `updated_at`, still `unstarted`) → comment a gentle "No activity in 21 days — propose closing?" → for clearly-abandoned ones, **propose** moving to `cancelled` **behind the approval gate** (see 8.7) → de-dupe stragglers via relations → normalize missing labels/priorities.
- **Timing:** scan (8 s) → a few proposals staggered 5 s apart.
- **Viewer sees:** the agent noticing rot a human would miss and proposing tidy-up — restraint, not just creation.
- **Stays calm:** proposals are comments/gated actions, never silent deletions.
- **Contract:** steps "Scan for stale", "Propose closures", "Normalize metadata".

### 8.7 Human-in-the-loop gate — `approval-gate` (REQUIRED demo beat)

- **Agent:** `execute` (reuses 8.6's closes, or a bulk reassignment). **Trigger:** the agent reaches an **irreversible** action (bulk-closing 6 stale items, or reassigning a whole component).
- **Sequence:** compute the batch → emit `approval_requested { summary: "Close 6 stale onboarding tickets?", irreversible: true }`, set run `awaiting_approval`, and **halt all writes**. On operator **approve** (`a`), execute the `DELETE`/`PATCH` batch, each narrated; on **reject** (`x`), skip and end `cancelled` with a "held for review" note.
- **Timing:** the gate holds indefinitely — this is the moment the presenter turns to the audience.
- **Viewer sees:** the run rises to the top of "Needs you," the presenter approves inline, and only _then_ does the batch execute — the human-in-the-loop story, live.
- **Stays calm:** this is the design's **attention layer** — the _only_ thing that interrupts, and only because it's irreversible + gated inline.
- **Contract:** exercises `awaiting_approval` + `approval_requested` + a `TAgentCommand` `approve`/`reject` round-trip end to end.

### The three "wow" moments (PM-specific delight)

- **8.8 `wow-standup` — the autonomous stand-up.** **Trigger:** on demand each "morning" of the demo. The agent reads the cycle's overnight state changes and comment trail and posts a **stand-up digest** on a pinned item: _"Yesterday: 3 shipped. Today: SSO migration (was blocked, IdP now provisioned). Risk: users-migration slips if IdP review lands late."_ It even **flags one item as at-risk** by cross-referencing a blocker whose target_date passed and bumps its priority. Viewer reaction: "it wrote our stand-up, and it caught the risk." Calm: one summary comment; the only escalation (the at-risk bump) is visible on the item, not a toast.

- **8.9 `wow-scope-guard` — the scope sentinel.** **Trigger:** operator (playing a teammate) adds a large, off-theme item to the active cycle mid-demo. Within seconds the agent notices the cycle's committed estimate now exceeds capacity, posts _"This pushes the cycle 8 points over — recommend moving 'Redesign settings' to next cycle,"_ and (behind the approval gate, 8.7-style) offers to move it. Viewer reaction: "it's watching scope creep in real time." Calm: a single recommendation comment + an optional gated move — advisory, never silent.

- **8.10 `wow-duplicate-storm` — the triage swarm.** **Trigger:** operator fires `sim run wow-duplicate-storm`, which creates 4 near-identical incident reports seconds apart (as if users are reporting one outage). The agent **recognizes them as one incident**: links all four as `duplicate` to a freshly-created canonical "Incident: checkout 5xx" item, escalates it to `urgent`, assigns the on-call, and posts a consolidated timeline comment. Four noisy tickets collapse into one calm, owned incident. Viewer reaction: "it turned chaos into one clean thread." Calm: the four dupes quietly fold under the canonical item; one incident surfaces, not four alerts.

---

## 9. Verification

1. **Guardrail unit tests** (`tests/guardrail.spec.ts`): `assertLocalhost` accepts `localhost`/`127.0.0.1`/`::1`/`0.0.0.0`, rejects `app.plane.so`, LAN IPs, and tunnels. Run: `pnpm --filter @plane/agents-demo test`.
2. **Journal mapping tests** (`journal.spec.ts`): a scripted scenario plan produces `TAgentRun`/`TAgentEvent` values that typecheck against `@plane/agents` and have monotonic per-run `sequence`; the approval scenario emits `approval_requested` + reaches `awaiting_approval`.
3. **Scenario planner tests** (`scenario-plan.spec.ts`): each `plan(ctx)` is deterministic under a fixed seed (same seed ⇒ identical step list).
4. **Dry-run smoke** against a live local instance: `sim run decompose-epic --dry-run` prints the full intended API sequence and mutates nothing (verify via the activities feed that no writes landed).
5. **Live end-to-end** on the local stack (web `:3000`, API `:8000`, workspace `klarity`, dedicated demo project): `sim seed` then `sim run decompose-epic --seed 42` — confirm in the web UI that the epic gains 5 ordered sub-issues with acceptance criteria; run `triage-and-route`, `dependency-graph`, `progress-orchestration`, `cycle-rollup`, `approval-gate` and eyeball each payoff.
6. **Contract-live bridge (optional):** start the `ws-mock` feed and point a dev build of the visibility panel at it; confirm a simulated run renders live in the panel and the approval gate is answerable from the UI.
7. **Teardown:** `sim teardown --yes` removes every `agent-demo`-marked item, the demo cycle/module/labels; verify the project is clean and no non-demo item was touched.
8. **Repeatability:** re-run step 5 with the same seed against a fresh teardown — confirm byte-identical narrative.

---

## 10. Open questions / unconfirmed

- **O1 — RESOLVED.** Both `cycle-issues` and `module-issues` create bodies are confirmed `{ "issues": [<uuid>, …] }` (`CycleIssueRequestSerializer` `cycle.py:176`; `ModuleIssueRequestSerializer` `module.py:274`). No longer an open question.
- **O2 — no runs backend. [RESOLVED 2026-07-10]** An `agent-runs` REST surface now exists: `packages/agents-demo/src/server.ts` (the HTTP bridge on `:4000`) serves `GET/POST /api/workspaces/:ws/agent-runs/…`, and the web panel **polls** it. The `apps/live` agent-events channel was never built. _(Originally: there is no `agent-runs` REST endpoint in the repo; the simulator owns the `TAgentRun`/`TAgentEvent` journal and surfaces it via console/file/`ws-mock` sinks.)_
- **O3 — estimate points.** `estimate_point` requires an estimate to be configured on the project. If the demo project has no estimate, skip `estimate_point` (leave `null`) or have `seed-world` create one via `/estimates/` first. Confirm the demo project's estimate setup before enabling estimate-setting steps.
- **O4 — `description_html` / `comment_html` sanitization.** Both pass through `validate_html_content`; the exact allowed tag/attribute set was not enumerated. Keep generated HTML to a conservative subset (`<p><ul><ol><li><strong><em><h3><a>`), and verify a sample round-trips unaltered before the demo.
- **O5 — API token scope.** Personal API tokens are workspace-scoped; confirm the token's user is a **member of the demo project** (assignee/label/state validation in `IssueSerializer` checks project membership) or writes referencing members will 400.
- **O6 — priority `none` vs blocked state.** Plane has no first-class "blocked" issue _state_ by default (blocking is modeled via relations, not a state group). Scenario 8.4's "flip to blocked" should use a custom `started`-group state named "Blocked" created by `seed-world`, or represent blocking purely via relations — decide during seed.
