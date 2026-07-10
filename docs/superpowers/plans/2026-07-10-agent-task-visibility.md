# Agent Task Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Plane users calm, non-intrusive visibility into long-running agent runs — watch, steer, interrupt, and review them live and after — via a compartmentalized `@plane/agents` package plus thin web adapters.

**Architecture:** All authoritative logic (contract types + a pure event→state reducer) lives framework-free in `@plane/agents`. `apps/web` adds thin adapters: a MobX store, a REST service (`APIService`), and a WebSocket transport that subscribes to a new agent-events channel on `apps/live`. The client holds no authoritative state — it is a projection rebuildable from `listRuns` + the event stream. Everything mounts behind a feature flag + error boundary via the `@/plane-web` CE alias, so "off" is byte-for-byte today's behavior.

**Tech Stack:** TypeScript, tsdown, Vitest, MobX / mobx-react, SWR, axios (via `@plane/services` `APIService`), `@plane/propel` + `@plane/ui` components, `apps/live` (Node + `ws` + Redis).

## Global Constraints

- Package name/namespace: `@plane/agents`; `"version": "1.3.1"`; `"private": true`; `"license": "AGPL-3.0"`; `"type": "module"`.
- Every source file starts with the SPDX header (see Task 1).
- Node `>=22.18.0`; pnpm `10.32.1`; deps pinned via `catalog:` where available.
- Lint/format: `oxlint` + `oxfmt` (NOT eslint/prettier). Test runner: `vitest`.
- Reducer must be **total** (never throw): unknown event types / statuses are ignored, not errors.
- No optimistic terminal transitions: command results are reflected only when the backend echoes an event.
- Gate evaluated **before** any socket/poll opens (flag-off ⇒ zero network footprint).
- Reduced-motion-safe; `role="status"` / `aria-live` on live state changes.
- Commit after every task with a Conventional Commit message.

## File Structure

**`@plane/agents` (package — pure core):**

- `packages/agents/vitest.config.ts` — node-env test config (create).
- `packages/agents/src/types/*` — contract (exists; extend with state types in Task 1).
- `packages/agents/src/state/types.ts` — `TAgentCollectionState` shape.
- `packages/agents/src/state/reducer.ts` — `applyEvent`, `reconcile` (pure).
- `packages/agents/src/state/selectors.ts` — grouping/ordering selectors (pure).
- `packages/agents/src/state/backoff.ts` — pure reconnect-backoff calc.
- `packages/agents/src/index.ts` — barrel (exists; extend).
- `packages/agents/tests/*.spec.ts` — vitest specs.

**`apps/web/ce/**`(thin adapters + UI, wired via`@/plane-web`):\*\*

- `apps/web/vitest.config.ts` — node-env config for adapter unit tests (create, Task 5).
- `apps/web/ce/services/agents/agent.service.ts` — `AgentService extends APIService implements IAgentService`.
- `apps/web/ce/store/agents/agent.store.ts` — MobX adapter over the reducer.
- `apps/web/ce/transport/agents/agent-event-transport.ts` — `IAgentEventTransport` WS impl.
- `apps/web/ce/hooks/agents/*` — `use-agent-subscription`, `use-agent-count`.
- `apps/web/ce/components/agents/*` — `agent-status-chip`, `agent-run-row`, `agents-panel`, `agent-run-detail`, `agent-inline-indicator`, `agents-header-pip`, `agents-error-boundary`, `agents-root` (lazy + flag gate).

**`apps/live/**`:\*\*

- `apps/live/src/controllers/agent-events.controller.ts` — authed subscribe + Redis relay + coalescing.
- `apps/live/tests/agent-events.spec.ts` — vitest.

---

## Phase 1 — `@plane/agents` pure core (fully TDD)

### Task 1: Test harness + state types

**Files:**

- Create: `packages/agents/vitest.config.ts`
- Create: `packages/agents/src/state/types.ts`
- Modify: `packages/agents/package.json` (add `test` script + `vitest` devDep)
- Modify: `packages/agents/src/index.ts` (export state types)
- Test: `packages/agents/tests/smoke.spec.ts`

**Interfaces:**

- Produces: `TAgentCollectionState = { runs: Record<string, TAgentRun>; lastSequence: Record<string, number> }`.

- [ ] **Step 1: Add test tooling to `package.json`**

Add to `scripts`: `"test": "vitest run"`, `"test:watch": "vitest"`. Add to `devDependencies`: `"vitest": "^4.0.8"`.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.spec.ts"],
  },
});
```

- [ ] **Step 3: Create `src/state/types.ts`**

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAgentRun } from "../types/session";

/** Client-side projection of server-owned run state. Never authoritative. */
export type TAgentCollectionState = {
  /** Runs by id. */
  runs: Record<string, TAgentRun>;
  /** Highest applied event `sequence` per run id (gap detection). */
  lastSequence: Record<string, number>;
};

export const emptyAgentState = (): TAgentCollectionState => ({
  runs: {},
  lastSequence: {},
});
```

- [ ] **Step 4: Export from `src/index.ts`**

Add `export * from "./state/types";` to the barrel.

- [ ] **Step 5: Write smoke test** — `tests/smoke.spec.ts`

```ts
import { describe, it, expect } from "vitest";
import { emptyAgentState } from "../src/state/types";

describe("emptyAgentState", () => {
  it("starts with no runs and no sequences", () => {
    const s = emptyAgentState();
    expect(s.runs).toEqual({});
    expect(s.lastSequence).toEqual({});
  });
});
```

- [ ] **Step 6: Install + run**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install && pnpm --filter @plane/agents test`
Expected: 1 passing test.

- [ ] **Step 7: Commit**

```bash
git add packages/agents pnpm-lock.yaml
git commit -m "test(agents): add vitest harness and collection state type"
```

---

### Task 2: `applyEvent` reducer

**Files:**

- Create: `packages/agents/src/state/reducer.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/tests/apply-event.spec.ts`

**Interfaces:**

- Consumes: `TAgentCollectionState`, `emptyAgentState` (Task 1); `TAgentEvent`, `TAgentRun`, `AGENT_TERMINAL_STATUSES` (contract).
- Produces: `applyEvent(state: TAgentCollectionState, event: TAgentEvent): TAgentCollectionState` — pure, returns a new state; ignores stale/duplicate `sequence` and unknown types.

- [ ] **Step 1: Write failing tests** — `tests/apply-event.spec.ts`

```ts
import { describe, it, expect } from "vitest";
import { emptyAgentState } from "../src/state/types";
import { applyEvent } from "../src/state/reducer";
import type { TAgentEvent } from "../src/types/events";
import type { TAgentRun } from "../src/types/session";

const baseRun = (over: Partial<TAgentRun> = {}): TAgentRun => ({
  id: "r1",
  agentKey: "triage",
  title: "Triage",
  status: "running",
  workspaceId: "w1",
  initiatedBy: "u1",
  createdAt: "t0",
  updatedAt: "t0",
  ...over,
});

const stateWith = (run: TAgentRun, seq = 0) => ({
  runs: { [run.id]: run },
  lastSequence: { [run.id]: seq },
});

const evt = (over: Partial<TAgentEvent> = {}): TAgentEvent =>
  ({
    runId: "r1",
    sequence: 1,
    timestamp: "t1",
    type: "status_changed",
    payload: { status: "succeeded" },
  }) as TAgentEvent;

describe("applyEvent", () => {
  it("applies a status change when sequence advances", () => {
    const next = applyEvent(stateWith(baseRun()), evt());
    expect(next.runs.r1.status).toBe("succeeded");
    expect(next.lastSequence.r1).toBe(1);
  });

  it("ignores a stale or duplicate sequence", () => {
    const next = applyEvent(stateWith(baseRun(), 5), evt({ sequence: 5 }));
    expect(next.runs.r1.status).toBe("running");
    expect(next.lastSequence.r1).toBe(5);
  });

  it("ignores events for an unknown run", () => {
    const next = applyEvent(emptyAgentState(), evt());
    expect(next.runs.r1).toBeUndefined();
  });

  it("ignores an unknown event type without throwing", () => {
    const next = applyEvent(stateWith(baseRun()), evt({ type: "bogus" as TAgentEvent["type"], payload: {} as never }));
    expect(next.runs.r1.status).toBe("running");
    expect(next.lastSequence.r1).toBe(1);
  });

  it("appends a step on step_started", () => {
    const e = evt({ type: "step_started", payload: { id: "s1", label: "label", status: "running" } });
    const next = applyEvent(stateWith(baseRun()), e);
    expect(next.runs.r1.steps).toEqual([{ id: "s1", label: "label", status: "running" }]);
  });

  it("merges progress", () => {
    const e = evt({ type: "progress", payload: { percent: 40, currentStep: 2, totalSteps: 5 } });
    const next = applyEvent(stateWith(baseRun()), e);
    expect(next.runs.r1.progress).toEqual({ percent: 40, currentStep: 2, totalSteps: 5 });
  });

  it("sets result + status on completed", () => {
    const e = evt({ type: "completed", payload: { status: "succeeded", result: { summary: "done" } } });
    const next = applyEvent(stateWith(baseRun()), e);
    expect(next.runs.r1.status).toBe("succeeded");
    expect(next.runs.r1.result).toEqual({ summary: "done" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @plane/agents test`
Expected: FAIL — `applyEvent` not found.

- [ ] **Step 3: Implement `src/state/reducer.ts`**

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAgentEvent } from "../types/events";
import type { TAgentRun, TAgentStep } from "../types/session";
import type { TAgentCollectionState } from "./types";

/** Merge a step into a run by id, appending if new. */
const upsertStep = (steps: TAgentStep[] | undefined, step: TAgentStep): TAgentStep[] => {
  const list = steps ? [...steps] : [];
  const i = list.findIndex((s) => s.id === step.id);
  if (i === -1) list.push(step);
  else list[i] = { ...list[i], ...step };
  return list;
};

/** Apply one event to one run, producing an updated run. */
const reduceRun = (run: TAgentRun, event: TAgentEvent): TAgentRun => {
  switch (event.type) {
    case "status_changed":
      return { ...run, status: event.payload.status };
    case "progress":
      return { ...run, progress: { ...run.progress, ...event.payload } };
    case "step_started":
    case "step_updated":
    case "step_completed":
      return { ...run, steps: upsertStep(run.steps, event.payload) };
    case "completed":
      return { ...run, status: event.payload.status, result: event.payload.result ?? run.result };
    case "error":
      return { ...run, status: "failed", error: event.payload };
    default:
      return run; // total: unknown types are ignored
  }
};

/**
 * Pure. Apply one event to the collection state.
 * Ignores events for unknown runs and stale/duplicate sequences.
 */
export const applyEvent = (state: TAgentCollectionState, event: TAgentEvent): TAgentCollectionState => {
  const run = state.runs[event.runId];
  if (!run) return state;
  const last = state.lastSequence[event.runId] ?? -Infinity;
  if (event.sequence <= last) return state;

  return {
    runs: { ...state.runs, [event.runId]: reduceRun(run, event) },
    lastSequence: { ...state.lastSequence, [event.runId]: event.sequence },
  };
};
```

Note: `input_requested` / `approval_requested` carry no run-field change here (the run's `status` is driven by a paired `status_changed`); they are surfaced to the UI via the store's event pass-through (Task 6). They fall through to `default` and are safely ignored by the reducer.

- [ ] **Step 4: Export from barrel** — add `export * from "./state/reducer";` to `src/index.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @plane/agents test`
Expected: PASS (all `applyEvent` tests).

- [ ] **Step 6: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add pure applyEvent reducer"
```

---

### Task 3: `reconcile` (snapshot rehydrate)

**Files:**

- Modify: `packages/agents/src/state/reducer.ts`
- Modify: `packages/agents/src/index.ts` (already re-exports reducer)
- Test: `packages/agents/tests/reconcile.spec.ts`

**Interfaces:**

- Consumes: `TAgentCollectionState`, `TAgentRun`.
- Produces: `reconcile(state: TAgentCollectionState, snapshot: TAgentRun[]): TAgentCollectionState` — replaces each run in the snapshot by id; runs absent from a _scoped_ snapshot are preserved (caller controls scope). Resets `lastSequence` to `-1` for freshly-loaded runs so the next event applies.

- [ ] **Step 1: Write failing tests** — `tests/reconcile.spec.ts`

```ts
import { describe, it, expect } from "vitest";
import { emptyAgentState } from "../src/state/types";
import { reconcile } from "../src/state/reducer";
import type { TAgentRun } from "../src/types/session";

const run = (id: string, status: TAgentRun["status"] = "running"): TAgentRun => ({
  id,
  agentKey: "k",
  title: id,
  status,
  workspaceId: "w1",
  initiatedBy: "u1",
  createdAt: "t",
  updatedAt: "t",
});

describe("reconcile", () => {
  it("loads snapshot runs by id", () => {
    const next = reconcile(emptyAgentState(), [run("a"), run("b")]);
    expect(Object.keys(next.runs).sort()).toEqual(["a", "b"]);
    expect(next.lastSequence.a).toBe(-1);
  });

  it("replaces an existing run with the authoritative snapshot version", () => {
    const start = { runs: { a: run("a", "running") }, lastSequence: { a: 9 } };
    const next = reconcile(start, [run("a", "succeeded")]);
    expect(next.runs.a.status).toBe("succeeded");
    expect(next.lastSequence.a).toBe(-1);
  });

  it("preserves runs not present in the snapshot", () => {
    const start = { runs: { a: run("a") }, lastSequence: { a: 3 } };
    const next = reconcile(start, [run("b")]);
    expect(next.runs.a).toBeDefined();
    expect(next.lastSequence.a).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @plane/agents test reconcile`
Expected: FAIL — `reconcile` not found.

- [ ] **Step 3: Implement — append to `src/state/reducer.ts`**

```ts
/**
 * Pure. Merge an authoritative snapshot into state, keyed by run id.
 * Runs absent from the snapshot are preserved (scope is the caller's choice).
 * lastSequence resets to -1 so the next streamed event applies cleanly.
 */
export const reconcile = (state: TAgentCollectionState, snapshot: TAgentRun[]): TAgentCollectionState => {
  const runs = { ...state.runs };
  const lastSequence = { ...state.lastSequence };
  for (const run of snapshot) {
    runs[run.id] = run;
    lastSequence[run.id] = -1;
  }
  return { runs, lastSequence };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @plane/agents test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add reconcile for snapshot rehydrate"
```

---

### Task 4: Selectors — priority grouping

**Files:**

- Create: `packages/agents/src/state/selectors.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/tests/selectors.spec.ts`

**Interfaces:**

- Consumes: `TAgentCollectionState`, `TAgentRun`, `AGENT_BLOCKED_STATUSES`, `AGENT_TERMINAL_STATUSES`.
- Produces:
  - `selectGroupedRuns(state): { blocked: TAgentRun[]; running: TAgentRun[]; queued: TAgentRun[]; done: TAgentRun[] }`
  - `selectActiveCount(state): number` (blocked + running + queued)
  - `selectRunsForTarget(state, target: { entityType: string; entityId: string }): TAgentRun[]`

- [ ] **Step 1: Write failing tests** — `tests/selectors.spec.ts`

```ts
import { describe, it, expect } from "vitest";
import { selectGroupedRuns, selectActiveCount, selectRunsForTarget } from "../src/state/selectors";
import type { TAgentRun } from "../src/types/session";

const run = (id: string, status: TAgentRun["status"], over: Partial<TAgentRun> = {}): TAgentRun => ({
  id,
  agentKey: "k",
  title: id,
  status,
  workspaceId: "w1",
  initiatedBy: "u1",
  createdAt: "t",
  updatedAt: "t",
  ...over,
});

const state = (runs: TAgentRun[]) => ({
  runs: Object.fromEntries(runs.map((r) => [r.id, r])),
  lastSequence: {},
});

describe("selectors", () => {
  it("groups by priority: blocked, running, queued, done", () => {
    const g = selectGroupedRuns(
      state([
        run("a", "running"),
        run("b", "awaiting_approval"),
        run("c", "queued"),
        run("d", "succeeded"),
        run("e", "waiting_for_input"),
        run("f", "paused"),
      ])
    );
    expect(g.blocked.map((r) => r.id).sort()).toEqual(["b", "e"]);
    expect(g.running.map((r) => r.id).sort()).toEqual(["a", "f"]);
    expect(g.queued.map((r) => r.id)).toEqual(["c"]);
    expect(g.done.map((r) => r.id)).toEqual(["d"]);
  });

  it("counts active runs (excludes terminal)", () => {
    expect(selectActiveCount(state([run("a", "running"), run("d", "cancelled")]))).toBe(1);
  });

  it("filters runs by target", () => {
    const rs = selectRunsForTarget(
      state([run("a", "running", { target: { entityType: "work_item", entityId: "PLAT-1" } }), run("b", "running")]),
      { entityType: "work_item", entityId: "PLAT-1" }
    );
    expect(rs.map((r) => r.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @plane/agents test selectors`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/state/selectors.ts`**

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { AGENT_BLOCKED_STATUSES, AGENT_TERMINAL_STATUSES } from "../types/session";
import type { TAgentRun, TAgentTarget } from "../types/session";
import type { TAgentCollectionState } from "./types";

const all = (state: TAgentCollectionState): TAgentRun[] => Object.values(state.runs);

export const selectGroupedRuns = (state: TAgentCollectionState) => {
  const groups = {
    blocked: [] as TAgentRun[],
    running: [] as TAgentRun[],
    queued: [] as TAgentRun[],
    done: [] as TAgentRun[],
  };
  for (const run of all(state)) {
    if (AGENT_BLOCKED_STATUSES.includes(run.status)) groups.blocked.push(run);
    else if (run.status === "running" || run.status === "paused") groups.running.push(run);
    else if (run.status === "queued") groups.queued.push(run);
    else if (AGENT_TERMINAL_STATUSES.includes(run.status)) groups.done.push(run);
  }
  return groups;
};

export const selectActiveCount = (state: TAgentCollectionState): number =>
  all(state).filter((r) => !AGENT_TERMINAL_STATUSES.includes(r.status)).length;

export const selectRunsForTarget = (
  state: TAgentCollectionState,
  target: Pick<TAgentTarget, "entityType" | "entityId">
): TAgentRun[] =>
  all(state).filter((r) => r.target?.entityType === target.entityType && r.target?.entityId === target.entityId);
```

- [ ] **Step 4: Export from barrel** — add `export * from "./state/selectors";` to `src/index.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @plane/agents test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add priority grouping + target selectors"
```

---

### Task 5: Pure reconnect backoff

**Files:**

- Create: `packages/agents/src/state/backoff.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/tests/backoff.spec.ts`

**Interfaces:**

- Produces: `backoffDelay(attempt: number, opts?: { base?: number; cap?: number }): number` — capped exponential, deterministic (jitter applied by the caller with an injected RNG so it stays testable).

- [ ] **Step 1: Write failing tests** — `tests/backoff.spec.ts`

```ts
import { describe, it, expect } from "vitest";
import { backoffDelay } from "../src/state/backoff";

describe("backoffDelay", () => {
  it("grows exponentially from base", () => {
    expect(backoffDelay(0, { base: 500, cap: 30000 })).toBe(500);
    expect(backoffDelay(1, { base: 500, cap: 30000 })).toBe(1000);
    expect(backoffDelay(3, { base: 500, cap: 30000 })).toBe(4000);
  });

  it("caps the delay", () => {
    expect(backoffDelay(20, { base: 500, cap: 30000 })).toBe(30000);
  });

  it("treats negative attempts as zero", () => {
    expect(backoffDelay(-3, { base: 500, cap: 30000 })).toBe(500);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @plane/agents test backoff`
Expected: FAIL.

- [ ] **Step 3: Implement `src/state/backoff.ts`**

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** Capped exponential backoff. Jitter is applied by the caller (kept pure/testable). */
export const backoffDelay = (attempt: number, opts: { base?: number; cap?: number } = {}): number => {
  const base = opts.base ?? 500;
  const cap = opts.cap ?? 30000;
  const n = Math.max(0, attempt);
  return Math.min(cap, base * 2 ** n);
};
```

- [ ] **Step 4: Export** — add `export * from "./state/backoff";` to `src/index.ts`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @plane/agents test`
Expected: PASS.

- [ ] **Step 6: Typecheck the whole package**

Run: `pnpm --filter @plane/agents check:types && pnpm --filter @plane/agents build`
Expected: no type errors; `dist/` emitted.

- [ ] **Step 7: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): add pure capped-exponential backoff"
```

---

## Phase 2 — web adapters (`apps/web/ce`)

### Task 6: REST service (`AgentService`)

**Files:**

- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/ce/services/agents/agent.service.ts`
- Modify: `apps/web/package.json` (add `test` script + `vitest` devDep)
- Test: `apps/web/ce/services/agents/agent.service.spec.ts`

**Interfaces:**

- Consumes: `APIService` (`@plane/services`), `IAgentService`, `TAgentRun`, `TAgentCommand` (`@plane/agents`).
- Produces: `class AgentService extends APIService implements IAgentService` with `listRuns`, `getRun`, `sendCommand`.

- [ ] **Step 1: Read the base class**

Read `packages/services/src/api.service.ts` — confirm the protected `get`/`post` helpers and constructor `(baseURL)` signature to mirror existing services.

- [ ] **Step 2: Add test tooling to `apps/web/package.json`**

Add `scripts.test`: `"vitest run"`. Add `devDependencies.vitest`: `"^4.0.8"`.

- [ ] **Step 3: Create `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["ce/**/*.spec.ts", "core/**/*.spec.ts"],
  },
});
```

- [ ] **Step 4: Write failing test** — `apps/web/ce/services/agents/agent.service.spec.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentService } from "./agent.service";

describe("AgentService", () => {
  it("POSTs a command to the run's command endpoint", async () => {
    const svc = new AgentService("http://x");
    const post = vi
      .spyOn(svc as unknown as { post: (...a: unknown[]) => Promise<unknown> }, "post")
      .mockResolvedValue({ data: {} });
    await svc.sendCommand({ workspaceId: "w1", command: { runId: "r1", type: "cancel", payload: {} } });
    expect(post).toHaveBeenCalledWith("/api/workspaces/w1/agent-runs/r1/commands/", { type: "cancel", payload: {} });
  });

  it("GETs the run list for a workspace", async () => {
    const svc = new AgentService("http://x");
    const get = vi
      .spyOn(svc as unknown as { get: (...a: unknown[]) => Promise<unknown> }, "get")
      .mockResolvedValue({ data: { runs: [], nextCursor: undefined } });
    const res = await svc.listRuns({ workspaceId: "w1" });
    expect(get).toHaveBeenCalledWith("/api/workspaces/w1/agent-runs/", { params: {} });
    expect(res.runs).toEqual([]);
  });
});
```

- [ ] **Step 5: Run to verify fail**

Run: `cd apps/web && pnpm vitest run ce/services/agents`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement `agent.service.ts`**

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { APIService } from "@plane/services";
import type { IAgentService, TAgentCommand, TAgentRun } from "@plane/agents";

export class AgentService extends APIService implements IAgentService {
  async listRuns(params: {
    workspaceId: string;
    target?: { entityType: string; entityId: string };
    statuses?: TAgentRun["status"][];
    cursor?: string;
  }): Promise<{ runs: TAgentRun[]; nextCursor?: string }> {
    const { workspaceId, ...query } = params;
    const res = await this.get(`/api/workspaces/${workspaceId}/agent-runs/`, { params: query });
    return res.data;
  }

  async getRun(params: { workspaceId: string; runId: string }): Promise<TAgentRun> {
    const res = await this.get(`/api/workspaces/${params.workspaceId}/agent-runs/${params.runId}/`);
    return res.data;
  }

  async sendCommand(params: { workspaceId: string; command: TAgentCommand }): Promise<void> {
    const { runId, ...body } = params.command;
    await this.post(`/api/workspaces/${params.workspaceId}/agent-runs/${runId}/commands/`, body);
  }
}
```

Note: the first test passes `{ params: {} }` — align the `listRuns` call so an empty query still sends `{ params: {} }` (it does: `query` is `{}` when only `workspaceId` given).

- [ ] **Step 7: Run to verify pass**

Run: `cd apps/web && pnpm vitest run ce/services/agents`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/package.json apps/web/ce/services/agents pnpm-lock.yaml
git commit -m "feat(web): add AgentService REST client + vitest setup"
```

---

### Task 7: MobX store adapter

**Files:**

- Create: `apps/web/ce/store/agents/agent.store.ts`
- Test: `apps/web/ce/store/agents/agent.store.spec.ts`

**Interfaces:**

- Consumes: `applyEvent`, `reconcile`, `emptyAgentState`, selectors (`@plane/agents`); `AgentService` (Task 6); `TAgentEvent`, `TAgentRun`.
- Produces: `class AgentStore` with observable `state: TAgentCollectionState`; methods `ingestEvent(e)`, `hydrate(runs)`, `get grouped()`, `get activeCount()`, `runsForTarget(target)`, `async loadRuns(params)`, `async runCommand(params)`. Also exposes an `onBlockingEvent` hook for `input_requested` / `approval_requested` pass-through.

- [ ] **Step 1: Write failing tests** — `agent.store.spec.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentStore } from "./agent.store";
import type { TAgentRun } from "@plane/agents";

const run = (id: string, status: TAgentRun["status"] = "running"): TAgentRun => ({
  id,
  agentKey: "k",
  title: id,
  status,
  workspaceId: "w1",
  initiatedBy: "u1",
  createdAt: "t",
  updatedAt: "t",
});

describe("AgentStore", () => {
  it("hydrates from a snapshot and exposes grouped runs", () => {
    const store = new AgentStore({} as never);
    store.hydrate([run("a", "running"), run("b", "awaiting_approval")]);
    expect(store.grouped.running.map((r) => r.id)).toEqual(["a"]);
    expect(store.grouped.blocked.map((r) => r.id)).toEqual(["b"]);
    expect(store.activeCount).toBe(2);
  });

  it("ingests an event through the reducer", () => {
    const store = new AgentStore({} as never);
    store.hydrate([run("a", "running")]);
    store.ingestEvent({
      runId: "a",
      sequence: 1,
      timestamp: "t",
      type: "status_changed",
      payload: { status: "succeeded" },
    });
    expect(store.grouped.done.map((r) => r.id)).toEqual(["a"]);
  });

  it("loadRuns delegates to the service and hydrates", async () => {
    const service = { listRuns: vi.fn().mockResolvedValue({ runs: [run("a")] }) };
    const store = new AgentStore({} as never, service as never);
    await store.loadRuns({ workspaceId: "w1" });
    expect(service.listRuns).toHaveBeenCalledWith({ workspaceId: "w1" });
    expect(store.grouped.running.map((r) => r.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/web && pnpm vitest run ce/store/agents`
Expected: FAIL.

- [ ] **Step 3: Implement `agent.store.ts`**

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
import {
  applyEvent,
  reconcile,
  emptyAgentState,
  selectGroupedRuns,
  selectActiveCount,
  selectRunsForTarget,
} from "@plane/agents";
import type {
  IAgentService,
  TAgentCollectionState,
  TAgentCommand,
  TAgentEvent,
  TAgentRun,
  TAgentTarget,
} from "@plane/agents";
import { AgentService } from "@/plane-web/services/agents/agent.service";

export class AgentStore {
  state: TAgentCollectionState = emptyAgentState();
  private service: IAgentService;

  constructor(
    private root: unknown,
    service?: IAgentService
  ) {
    this.service = service ?? new AgentService();
    makeObservable(this, {
      state: observable.ref,
      grouped: computed,
      activeCount: computed,
      ingestEvent: action,
      hydrate: action,
    });
  }

  get grouped() {
    return selectGroupedRuns(this.state);
  }
  get activeCount() {
    return selectActiveCount(this.state);
  }
  runsForTarget(target: Pick<TAgentTarget, "entityType" | "entityId">): TAgentRun[] {
    return selectRunsForTarget(this.state, target);
  }

  ingestEvent(event: TAgentEvent) {
    this.state = applyEvent(this.state, event);
  }
  hydrate(runs: TAgentRun[]) {
    this.state = reconcile(this.state, runs);
  }

  async loadRuns(params: Parameters<IAgentService["listRuns"]>[0]) {
    const { runs } = await this.service.listRuns(params);
    runInAction(() => this.hydrate(runs));
  }

  async runCommand(params: { workspaceId: string; command: TAgentCommand }) {
    await this.service.sendCommand(params); // no optimistic terminal transition
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && pnpm vitest run ce/store/agents`
Expected: PASS.

- [ ] **Step 5: Wire into the root store**

Modify `apps/web/core/store/root.store.ts`: add field `agents: AgentStore;`, import it, and in the constructor add `this.agents = new AgentStore(this);` alongside the other stores. Confirm the app still typechecks: `cd apps/web && pnpm check:types`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/ce/store/agents apps/web/core/store/root.store.ts
git commit -m "feat(web): add AgentStore MobX adapter wired to root store"
```

---

### Task 8: WebSocket transport adapter

**Files:**

- Create: `apps/web/ce/transport/agents/agent-event-transport.ts`
- Test: `apps/web/ce/transport/agents/agent-event-transport.spec.ts`

**Interfaces:**

- Consumes: `IAgentEventTransport`, `TAgentTransportSubscription`, `TAgentEvent`, `backoffDelay` (`@plane/agents`).
- Produces: `class AgentEventTransport implements IAgentEventTransport`, constructed with an injectable socket factory `(url: string) => IAgentSocket` for testability, where `IAgentSocket = { onMessage; onClose; onError; close }`.

- [ ] **Step 1: Write failing tests** — `agent-event-transport.spec.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentEventTransport, type IAgentSocket } from "./agent-event-transport";

function fakeSocket() {
  const s: IAgentSocket & { emitMessage: (d: unknown) => void; emitClose: () => void } = {
    onMessage: () => {},
    onClose: () => {},
    onError: () => {},
    close: vi.fn(),
    emitMessage(d) {
      this.onMessage(d);
    },
    emitClose() {
      this.onClose();
    },
  };
  return s;
}

describe("AgentEventTransport", () => {
  it("delivers parsed events to onEvent", () => {
    const socket = fakeSocket();
    const t = new AgentEventTransport("ws://x", () => socket);
    const events: unknown[] = [];
    t.subscribe({ workspaceId: "w1", onEvent: (e) => events.push(e) });
    socket.emitMessage({ runId: "r1", sequence: 1, timestamp: "t", type: "progress", payload: { percent: 10 } });
    expect(events).toHaveLength(1);
  });

  it("reports disconnect via onStatusChange and does not throw on bad payloads", () => {
    const socket = fakeSocket();
    const t = new AgentEventTransport("ws://x", () => socket);
    const statuses: boolean[] = [];
    t.subscribe({ workspaceId: "w1", onEvent: () => {}, onStatusChange: (c) => statuses.push(c) });
    expect(() => socket.emitMessage("not-json{")).not.toThrow();
    socket.emitClose();
    expect(statuses).toContain(false);
  });

  it("closes the socket on unsubscribe", () => {
    const socket = fakeSocket();
    const t = new AgentEventTransport("ws://x", () => socket);
    const sub = t.subscribe({ workspaceId: "w1", onEvent: () => {} });
    sub.unsubscribe();
    expect(socket.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/web && pnpm vitest run ce/transport/agents`
Expected: FAIL.

- [ ] **Step 3: Implement `agent-event-transport.ts`**

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IAgentEventTransport, TAgentEvent, TAgentTransportSubscription } from "@plane/agents";

export interface IAgentSocket {
  onMessage: (data: unknown) => void;
  onClose: () => void;
  onError: (err: unknown) => void;
  close: () => void;
}

export type TAgentSocketFactory = (url: string) => IAgentSocket;

const parseEvent = (data: unknown): TAgentEvent | null => {
  try {
    const obj = typeof data === "string" ? JSON.parse(data) : data;
    if (obj && typeof obj === "object" && "runId" in obj && "sequence" in obj && "type" in obj) {
      return obj as TAgentEvent;
    }
  } catch {
    // malformed frame — ignored, never thrown into the app
  }
  return null;
};

export class AgentEventTransport implements IAgentEventTransport {
  constructor(
    private baseUrl: string,
    private factory: TAgentSocketFactory
  ) {}

  subscribe(params: {
    workspaceId: string;
    runIds?: string[];
    onEvent: (event: TAgentEvent) => void;
    onStatusChange?: (connected: boolean) => void;
  }): TAgentTransportSubscription {
    const socket = this.factory(`${this.baseUrl}/agent-events/${params.workspaceId}`);
    socket.onMessage = (data) => {
      const event = parseEvent(data);
      if (event) params.onEvent(event);
    };
    socket.onClose = () => params.onStatusChange?.(false);
    socket.onError = () => params.onStatusChange?.(false);
    params.onStatusChange?.(true);
    return { unsubscribe: () => socket.close() };
  }
}
```

Note: reconnect is driven by the subscription hook (Task 9) using `backoffDelay` — the transport stays a thin, testable I/O shim. This keeps timer logic out of the unit test.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/web && pnpm vitest run ce/transport/agents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/ce/transport/agents
git commit -m "feat(web): add WebSocket agent-event transport adapter"
```

---

### Task 9: Subscription + count hooks (lazy, flag-gated)

**Files:**

- Create: `apps/web/ce/hooks/agents/use-agent-subscription.ts`
- Create: `apps/web/ce/hooks/agents/use-agent-count.ts`
- Test: `apps/web/ce/hooks/agents/use-agent-subscription.spec.ts` (pure helper only)

**Interfaces:**

- Consumes: `AgentStore` (via root store hook), `AgentEventTransport`, `backoffDelay`, a real WS socket factory.
- Produces: `useAgentSubscription({ enabled, workspaceId, runIds? })` — opens the transport only when `enabled` (flag + actively watching), tears down on unmount / `enabled=false` / tab-hidden; reconnects with `backoffDelay`. `useAgentCount({ enabled, workspaceId })` — SWR poll (`refreshInterval: 45000`, `revalidateOnFocus: true`) of `listRuns` active count; returns `0` when disabled. Plus a pure helper `shouldSubscribe({ enabled, hasWatchTargets })` (unit-tested).

- [ ] **Step 1: Write failing test for the pure helper** — `use-agent-subscription.spec.ts`

```ts
import { describe, it, expect } from "vitest";
import { shouldSubscribe } from "./use-agent-subscription";

describe("shouldSubscribe", () => {
  it("is false when disabled", () => {
    expect(shouldSubscribe({ enabled: false, hasWatchTargets: true })).toBe(false);
  });
  it("is false when nothing to watch", () => {
    expect(shouldSubscribe({ enabled: true, hasWatchTargets: false })).toBe(false);
  });
  it("is true only when enabled and watching", () => {
    expect(shouldSubscribe({ enabled: true, hasWatchTargets: true })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/web && pnpm vitest run ce/hooks/agents`
Expected: FAIL.

- [ ] **Step 3: Implement `use-agent-subscription.ts`**

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { backoffDelay } from "@plane/agents";
import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";
import { AgentEventTransport } from "@/plane-web/transport/agents/agent-event-transport";
import { createBrowserAgentSocket } from "@/plane-web/transport/agents/browser-socket";
import { LIVE_BASE_URL } from "@/helpers/common.helper";

/** Pure: decide whether a live subscription should be open. */
export const shouldSubscribe = (p: { enabled: boolean; hasWatchTargets: boolean }): boolean =>
  p.enabled && p.hasWatchTargets;

export const useAgentSubscription = (p: { enabled: boolean; workspaceId: string; runIds?: string[] }) => {
  const store = useAgentStore();
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const active = shouldSubscribe({ enabled: p.enabled, hasWatchTargets: true });
    if (!active || typeof document === "undefined") return;

    let sub: { unsubscribe: () => void } | undefined;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const transport = new AgentEventTransport(LIVE_BASE_URL, createBrowserAgentSocket);
      sub = transport.subscribe({
        workspaceId: p.workspaceId,
        runIds: p.runIds,
        onEvent: (e) => store.ingestEvent(e),
        onStatusChange: (connected) => {
          if (connected) attemptRef.current = 0;
          else {
            const delay = backoffDelay(attemptRef.current++);
            timerRef.current = setTimeout(connect, delay + Math.floor(Math.random() * 250));
          }
        },
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") sub?.unsubscribe();
      else if (!cancelled) connect();
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      sub?.unsubscribe();
    };
  }, [p.enabled, p.workspaceId, JSON.stringify(p.runIds), store]);
};
```

- [ ] **Step 4: Implement `use-agent-count.ts`**

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import { AgentService } from "@/plane-web/services/agents/agent.service";

const service = new AgentService();

export const useAgentCount = (p: { enabled: boolean; workspaceId: string }) => {
  const { data } = useSWR(
    p.enabled ? ["agent-count", p.workspaceId] : null,
    async () => {
      const { runs } = await service.listRuns({
        workspaceId: p.workspaceId,
        statuses: ["queued", "running", "waiting_for_input", "awaiting_approval"],
      });
      return runs.length;
    },
    { refreshInterval: 45000, revalidateOnFocus: true }
  );
  return p.enabled ? (data ?? 0) : 0;
};
```

- [ ] **Step 5: Add the small support files**

Create `apps/web/ce/hooks/agents/use-agent-store.ts` (returns `useStore().agents` via the existing `useStore` hook — check `apps/web/core/hooks/store` for the exact export name and mirror it). Create `apps/web/ce/transport/agents/browser-socket.ts` implementing `createBrowserAgentSocket(url): IAgentSocket` over the native `WebSocket`. Confirm `LIVE_BASE_URL` exists in `apps/web/core/helpers/common.helper.ts`; if named differently, use the existing live-URL constant.

- [ ] **Step 6: Run to verify pass + typecheck**

Run: `cd apps/web && pnpm vitest run ce/hooks/agents && pnpm check:types`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/ce/hooks/agents apps/web/ce/transport/agents/browser-socket.ts apps/web/ce/hooks/agents/use-agent-store.ts
git commit -m "feat(web): add lazy agent subscription + ambient count hooks"
```

---

## Phase 3 — UI (`apps/web/ce/components/agents`)

> Components are thin and verified via the app-run (Task 14) + Storybook, not unit tests (no DOM test env in v1). Each uses `@plane/propel` / `@plane/ui` primitives and `variables.css` tokens. Reduced-motion + `aria-live` required on live state.

### Task 10: Status chip + glyph

**Files:**

- Create: `apps/web/ce/components/agents/agent-status-chip.tsx`
- Create: `apps/web/ce/components/agents/status-presentation.ts`
- Test: `apps/web/ce/components/agents/status-presentation.spec.ts`

**Interfaces:**

- Produces: `statusPresentation(status: TAgentRunStatus): { label: string; tone: "live" | "attention" | "success" | "fail" | "queued" }` (pure, tested) and a `<AgentStatusChip status />` using it.

- [ ] **Step 1: Failing test** — `status-presentation.spec.ts`

```ts
import { describe, it, expect } from "vitest";
import { statusPresentation } from "./status-presentation";

describe("statusPresentation", () => {
  it("maps blocked statuses to the attention tone", () => {
    expect(statusPresentation("awaiting_approval").tone).toBe("attention");
    expect(statusPresentation("waiting_for_input").tone).toBe("attention");
  });
  it("maps running to live and failed to fail", () => {
    expect(statusPresentation("running").tone).toBe("live");
    expect(statusPresentation("failed").tone).toBe("fail");
  });
  it("gives every status a human label", () => {
    expect(statusPresentation("succeeded").label.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `cd apps/web && pnpm vitest run ce/components/agents` → FAIL.

- [ ] **Step 3: Implement `status-presentation.ts`**

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAgentRunStatus } from "@plane/agents";

type Tone = "live" | "attention" | "success" | "fail" | "queued";

const MAP: Record<TAgentRunStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "queued" },
  running: { label: "Running", tone: "live" },
  paused: { label: "Paused", tone: "queued" },
  waiting_for_input: { label: "Needs you", tone: "attention" },
  awaiting_approval: { label: "Needs you", tone: "attention" },
  succeeded: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "fail" },
  cancelled: { label: "Cancelled", tone: "queued" },
};

export const statusPresentation = (status: TAgentRunStatus) =>
  MAP[status] ?? { label: "Unknown", tone: "queued" as Tone };
```

- [ ] **Step 4: Implement `agent-status-chip.tsx`**

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import type { TAgentRunStatus } from "@plane/agents";
import { statusPresentation } from "./status-presentation";

const TONE_CLASS: Record<string, string> = {
  live: "text-[--live] bg-[--live-soft]",
  attention: "text-[--attention] bg-[--attention-soft]",
  success: "text-[--success] bg-[--success-soft]",
  fail: "text-[--fail] bg-[--fail-soft]",
  queued: "text-custom-text-300 bg-custom-background-80",
};

export const AgentStatusChip = observer(({ status }: { status: TAgentRunStatus }) => {
  const { label, tone } = statusPresentation(status);
  return (
    <span className={`text-[10.5px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${TONE_CLASS[tone]}`}>
      {label}
    </span>
  );
});
```

Note: confirm the exact Plane token class names (`custom-text-300`, `custom-background-80`) against `@plane/tailwind-config`; the `--live`/`--attention` custom properties are added to the agents styles in Task 11.

- [ ] **Step 5: Run to verify pass** — `cd apps/web && pnpm vitest run ce/components/agents` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/ce/components/agents/agent-status-chip.tsx apps/web/ce/components/agents/status-presentation.ts
git commit -m "feat(web): add agent status chip + pure presentation mapping"
```

---

### Task 11: Run row + panel

**Files:**

- Create: `apps/web/ce/components/agents/agent-run-row.tsx`
- Create: `apps/web/ce/components/agents/agents-panel.tsx`
- Create: `apps/web/ce/components/agents/agents.styles.css`

**Interfaces:**

- Consumes: `AgentStore.grouped`, `AgentStatusChip`, `TAgentRun`, `runCommand`. `@plane/propel/scrollarea`, `@plane/propel/skeleton`.
- Produces: `<AgentRunRow run onCommand />`, `<AgentsPanel workspaceId />` (grouped: Needs you → Running → Queued → Recently done).

- [ ] **Step 1: Implement `agents.styles.css`** — define the `--live/--attention/--success/--fail` custom properties + `-soft` variants for light/dark, matching the spec palette (copy the token values from `docs/superpowers/specs/2026-07-10-agent-task-visibility-predraft.html`). Import it once from `agents-panel.tsx`.

- [ ] **Step 2: Implement `agent-run-row.tsx`**

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import type { TAgentCommand, TAgentRun } from "@plane/agents";
import { AgentStatusChip } from "./agent-status-chip";

export const AgentRunRow = observer(
  ({
    run,
    onCommand,
    onRequestCancel,
    onUndoCancel,
    pendingCancel,
  }: {
    run: TAgentRun;
    onCommand: (c: TAgentCommand) => void;
    onRequestCancel: (runId: string) => void;
    onUndoCancel: (runId: string) => void;
    pendingCancel: boolean;
  }) => {
    const steps = run.progress?.totalSteps ?? 0;
    const done = run.progress?.currentStep ?? 0;
    return (
      <div className="px-4 py-3 border-b border-custom-border-200" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{run.title}</span>
          <AgentStatusChip status={run.status} />
        </div>
        {run.target?.entityName && <div className="text-xs text-custom-text-300 mt-0.5">{run.target.entityName}</div>}
        {run.status === "running" && steps > 0 && (
          <div className="flex gap-0.5 mt-2" aria-label={`step ${done} of ${steps}`}>
            {Array.from({ length: steps }).map((_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-sm ${i < done ? "bg-[--live]" : "bg-custom-background-80"}`}
              />
            ))}
          </div>
        )}
        <div className="flex gap-1.5 mt-2">
          {run.status === "awaiting_approval" && (
            <>
              <button
                className="text-xs font-medium rounded px-2.5 py-1 bg-[--attention] text-white"
                onClick={() => onCommand({ runId: run.id, type: "approve", payload: { approvalId: "" } })}
              >
                Approve
              </button>
              <button
                className="text-xs font-medium rounded px-2.5 py-1 border border-custom-border-300"
                onClick={() => onCommand({ runId: run.id, type: "reject", payload: { approvalId: "" } })}
              >
                Reject
              </button>
            </>
          )}
          {/* Recovery model: Pause is the non-destructive default; hard Cancel is
            secondary and deferred behind an Undo (onRequestCancel/onUndoCancel). */}
          {!pendingCancel && run.status === "running" && (
            <button
              className="text-xs font-medium rounded px-2.5 py-1 border border-custom-border-300"
              onClick={() => onCommand({ runId: run.id, type: "pause", payload: {} })}
            >
              Pause
            </button>
          )}
          {!pendingCancel && run.status === "paused" && (
            <>
              <button
                className="text-xs font-medium rounded px-2.5 py-1 bg-[--live] text-white"
                onClick={() => onCommand({ runId: run.id, type: "resume", payload: {} })}
              >
                Resume
              </button>
              <button
                className="text-xs font-medium rounded px-2.5 py-1 border border-custom-border-300"
                onClick={() => onRequestCancel(run.id)}
              >
                Cancel run
              </button>
            </>
          )}
          {!pendingCancel && run.status === "queued" && (
            <button
              className="text-xs font-medium rounded px-2.5 py-1 border border-custom-border-300"
              onClick={() => onRequestCancel(run.id)}
            >
              Cancel
            </button>
          )}
          {pendingCancel && (
            <button
              className="text-xs font-medium rounded px-2.5 py-1 border border-[--accent] text-[--accent]"
              onClick={() => onUndoCancel(run.id)}
            >
              ↩ Undo stop
            </button>
          )}
          {run.status === "failed" && (
            <button
              className="text-xs font-medium rounded px-2.5 py-1 border border-custom-border-300"
              onClick={() => onCommand({ runId: run.id, type: "retry", payload: {} })}
            >
              Retry
            </button>
          )}
          {run.status === "succeeded" && run.result?.reviewUrl && (
            <a className="text-xs font-medium text-custom-primary-100 py-1" href={run.result.reviewUrl}>
              Review changes →
            </a>
          )}
        </div>
      </div>
    );
  }
);
```

Note: `approvalId` is threaded from the run's latest `approval_requested` event via the store's blocking-event pass-through (Task 7 `onBlockingEvent`); wire the real id when that hook lands. For v1 the row reads it from `run` once the contract carries the pending approval id (add `pendingApprovalId?: string` to `TAgentRun` if backend provides it — otherwise the detail view (Task 12) owns approvals).

- [ ] **Step 3: Implement `agents-panel.tsx`**

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { ScrollArea } from "@plane/propel/scrollarea";
import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";
import { useAgentSubscription } from "@/plane-web/hooks/agents/use-agent-subscription";
import { AgentRunRow } from "./agent-run-row";
import { useDeferredCancel } from "@/plane-web/hooks/agents/use-deferred-cancel";
import "./agents.styles.css";

const GROUPS: { key: "blocked" | "running" | "queued" | "done"; label: string }[] = [
  { key: "blocked", label: "Needs you" },
  { key: "running", label: "Running" },
  { key: "queued", label: "Queued" },
  { key: "done", label: "Recently done" },
];

export const AgentsPanel = observer(({ workspaceId }: { workspaceId: string }) => {
  const store = useAgentStore();
  useEffect(() => {
    store.loadRuns({ workspaceId });
  }, [store, workspaceId]);
  useAgentSubscription({ enabled: true, workspaceId });

  const grouped = store.grouped;
  const onCommand = (c: Parameters<typeof store.runCommand>[0]["command"]) =>
    store.runCommand({ workspaceId, command: c });
  const { pending, requestCancel, undoCancel } = useDeferredCancel(workspaceId);

  const empty = GROUPS.every((g) => grouped[g.key].length === 0);
  return (
    <ScrollArea className="h-full">
      {empty && <div className="p-6 text-sm text-custom-text-300">No agent activity yet.</div>}
      {GROUPS.map((g) =>
        grouped[g.key].length ? (
          <div key={g.key}>
            <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-custom-text-400">{g.label}</div>
            {grouped[g.key].map((run) => (
              <AgentRunRow
                key={run.id}
                run={run}
                onCommand={onCommand}
                onRequestCancel={requestCancel}
                onUndoCancel={undoCancel}
                pendingCancel={pending.has(run.id)}
              />
            ))}
          </div>
        ) : null
      )}
    </ScrollArea>
  );
});
```

- [ ] **Step 4: Implement `use-deferred-cancel.ts`** (recovery model)

Create `apps/web/ce/hooks/agents/use-deferred-cancel.ts`. Hard-cancel is **not**
dispatched immediately: it is held for `CANCEL_UNDO_MS` behind an Undo. If undone,
the `cancel` command is never sent and the agent never stopped.

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";

export const CANCEL_UNDO_MS = 5000;

export const useDeferredCancel = (workspaceId: string) => {
  const store = useAgentStore();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clear = useCallback((runId: string) => {
    const tm = timers.current.get(runId);
    if (tm) clearTimeout(tm);
    timers.current.delete(runId);
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(runId);
      return next;
    });
  }, []);

  const requestCancel = useCallback(
    (runId: string) => {
      setPending((prev) => new Set(prev).add(runId));
      const tm = setTimeout(() => {
        clear(runId);
        void store.runCommand({ workspaceId, command: { runId, type: "cancel", payload: {} } });
      }, CANCEL_UNDO_MS);
      timers.current.set(runId, tm);
    },
    [clear, store, workspaceId]
  );

  const undoCancel = useCallback((runId: string) => clear(runId), [clear]); // command never sent

  useEffect(() => () => timers.current.forEach((tm) => clearTimeout(tm)), []);

  return { pending, requestCancel, undoCancel };
};
```

- [ ] **Step 5: Typecheck** — `cd apps/web && pnpm check:types` → no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/ce/components/agents/agent-run-row.tsx apps/web/ce/components/agents/agents-panel.tsx apps/web/ce/components/agents/agents.styles.css apps/web/ce/hooks/agents/use-deferred-cancel.ts
git commit -m "feat(web): add agent run row + grouped panel"
```

---

### Task 12: Run detail (timeline + steer + approvals)

**Files:**

- Create: `apps/web/ce/components/agents/agent-run-detail.tsx`

**Interfaces:**

- Consumes: a `TAgentRun` (with `steps`), `runCommand`, `@plane/propel/collapsible`.
- Produces: `<AgentRunDetail run workspaceId />` — collapsed-by-default step log, a steer input emitting `correct`, inline `provide_input` when `waiting_for_input`, inline `approve`/`reject` when `awaiting_approval`.

- [ ] **Step 1: Implement `agent-run-detail.tsx`**

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import type { TAgentRun } from "@plane/agents";
import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";

export const AgentRunDetail = observer(({ run, workspaceId }: { run: TAgentRun; workspaceId: string }) => {
  const store = useAgentStore();
  const [steer, setSteer] = useState("");
  const send = (command: Parameters<typeof store.runCommand>[0]["command"]) =>
    store.runCommand({ workspaceId, command });

  return (
    <div className="p-4">
      <ol className="space-y-1.5 text-xs" aria-live="polite">
        {(run.steps ?? []).map((s) => (
          <li key={s.id} className="flex gap-2">
            <span className="text-custom-text-400">
              {s.status === "running" ? "▶" : s.status === "succeeded" ? "✓" : "·"}
            </span>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>

      {run.status === "waiting_for_input" && (
        <SteerBox
          placeholder="Answer the agent…"
          onSubmit={(v) => send({ runId: run.id, type: "provide_input", payload: { promptId: "", response: v } })}
        />
      )}
      {run.status === "running" && (
        <SteerBox
          placeholder="Steer this run…"
          value={steer}
          onChange={setSteer}
          onSubmit={(v) => {
            send({ runId: run.id, type: "correct", payload: { guidance: v } });
            setSteer("");
          }}
        />
      )}
      {run.status === "awaiting_approval" && (
        <div className="flex gap-2 mt-3">
          <button
            className="text-xs rounded px-2.5 py-1 bg-[--attention] text-white"
            onClick={() => send({ runId: run.id, type: "approve", payload: { approvalId: "" } })}
          >
            Approve
          </button>
          <button
            className="text-xs rounded px-2.5 py-1 border border-custom-border-300"
            onClick={() => send({ runId: run.id, type: "reject", payload: { approvalId: "" } })}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
});

const SteerBox = ({
  placeholder,
  value,
  onChange,
  onSubmit,
}: {
  placeholder: string;
  value?: string;
  onChange?: (v: string) => void;
  onSubmit: (v: string) => void;
}) => {
  const [local, setLocal] = useState("");
  const v = value ?? local;
  const set = onChange ?? setLocal;
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSubmit(v.trim());
      }}
    >
      <input
        className="flex-1 text-xs rounded border border-custom-border-300 px-2 py-1 bg-custom-background-100"
        placeholder={placeholder}
        value={v}
        onChange={(e) => set(e.target.value)}
      />
      <button className="text-xs rounded px-2.5 py-1 border border-custom-border-300" type="submit">
        Send
      </button>
    </form>
  );
};
```

- [ ] **Step 2: Typecheck** — `cd apps/web && pnpm check:types` → no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/ce/components/agents/agent-run-detail.tsx
git commit -m "feat(web): add agent run detail with steer + approvals"
```

---

### Task 13: Inline work-item indicator

**Files:**

- Create: `apps/web/ce/components/agents/agent-inline-indicator.tsx`
- Modify: the work-item detail sidebar/header (locate the mount point; see Step 2).

**Interfaces:**

- Consumes: `AgentStore.runsForTarget`, `useAgentSubscription`, `AgentStatusChip`.
- Produces: `<AgentInlineIndicator workspaceId entityType="work_item" entityId />` — a compact chip if ≥1 run targets this item; click opens the panel focused on that run.

- [ ] **Step 1: Implement `agent-inline-indicator.tsx`**

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";
import { useAgentSubscription } from "@/plane-web/hooks/agents/use-agent-subscription";
import { AgentStatusChip } from "./agent-status-chip";

export const AgentInlineIndicator = observer(
  ({
    workspaceId,
    entityType,
    entityId,
    onOpen,
  }: {
    workspaceId: string;
    entityType: string;
    entityId: string;
    onOpen: (runId: string) => void;
  }) => {
    const store = useAgentStore();
    const runs = store.runsForTarget({ entityType, entityId });
    useAgentSubscription({ enabled: runs.length > 0, workspaceId, runIds: runs.map((r) => r.id) });
    if (!runs.length) return null;
    const primary = runs[0];
    return (
      <button className="inline-flex items-center gap-1.5 text-xs" onClick={() => onOpen(primary.id)}>
        <span className="text-custom-text-300">🤖</span>
        <AgentStatusChip status={primary.status} />
        {runs.length > 1 && <span className="text-custom-text-400">+{runs.length - 1}</span>}
      </button>
    );
  }
);
```

- [ ] **Step 2: Mount it** — locate the work-item detail root under `apps/web/core/components/issues/issue-detail/` and render `<AgentInlineIndicator .../>` in the header/sidebar area, gated by the feature flag (Task 14). Pass `onOpen` to the panel opener from Task 14.

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/web && pnpm check:types
git add apps/web/ce/components/agents/agent-inline-indicator.tsx apps/web/core/components/issues/issue-detail
git commit -m "feat(web): add inline agent indicator on work items"
```

---

### Task 14: Header pip, flag gate, lazy mount, error boundary

**Files:**

- Create: `apps/web/ce/components/agents/agents-error-boundary.tsx`
- Create: `apps/web/ce/components/agents/agents-header-pip.tsx`
- Create: `apps/web/ce/components/agents/agents-root.tsx`
- Modify: the workspace header/layout mount point (see Step 4).

**Interfaces:**

- Consumes: `useAgentCount`, `AgentsPanel` (lazy), a feature-flag hook `useAgentsEnabled()`.
- Produces: `<AgentsRoot workspaceId />` — evaluates the flag first; if off, renders `null` (no imports executed, no network). If on, renders the pip + lazy-loaded panel inside the error boundary.

- [ ] **Step 1: Implement `agents-error-boundary.tsx`**

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Component, type ReactNode } from "react";

export class AgentsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[agents] surface error", error);
  }
  render() {
    if (this.state.failed) return <div className="p-4 text-xs text-custom-text-400">Agents unavailable.</div>;
    return this.props.children;
  }
}
```

- [ ] **Step 2: Implement `agents-header-pip.tsx`**

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useAgentCount } from "@/plane-web/hooks/agents/use-agent-count";

export const AgentsHeaderPip = observer(
  ({ workspaceId, enabled, onClick }: { workspaceId: string; enabled: boolean; onClick: () => void }) => {
    const count = useAgentCount({ enabled, workspaceId });
    return (
      <button className="inline-flex items-center gap-1.5 text-sm" onClick={onClick} aria-label="Agents">
        <span
          className={`w-2 h-2 rounded-full ${count > 0 ? "bg-[--live] motion-safe:animate-pulse" : "bg-custom-background-80"}`}
        />
        <span>Agents</span>
        {count > 0 && <span className="text-xs text-custom-text-300">{count}</span>}
      </button>
    );
  }
);
```

- [ ] **Step 3: Implement `agents-root.tsx`**

```tsx
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { lazy, Suspense, useState } from "react";
import { AgentsErrorBoundary } from "./agents-error-boundary";
import { AgentsHeaderPip } from "./agents-header-pip";
import { useAgentsEnabled } from "@/plane-web/hooks/agents/use-agents-enabled";

const AgentsPanel = lazy(() => import("./agents-panel").then((m) => ({ default: m.AgentsPanel })));

export const AgentsRoot = ({ workspaceId }: { workspaceId: string }) => {
  const enabled = useAgentsEnabled();
  const [open, setOpen] = useState(false);
  if (!enabled) return null; // gate BEFORE any hook that opens a socket/poll
  return (
    <AgentsErrorBoundary>
      <AgentsHeaderPip workspaceId={workspaceId} enabled={enabled} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className="fixed right-0 top-14 bottom-0 w-[340px] bg-custom-background-100 border-l border-custom-border-200 z-20">
          <Suspense fallback={<div className="p-4 text-xs text-custom-text-400">Loading…</div>}>
            <AgentsPanel workspaceId={workspaceId} />
          </Suspense>
        </div>
      )}
    </AgentsErrorBoundary>
  );
};
```

- [ ] **Step 4: Implement `use-agents-enabled.ts`** — create `apps/web/ce/hooks/agents/use-agents-enabled.ts` returning the flag value. In CE with no flag service, return a build/env constant (e.g. `process.env.NEXT_PUBLIC_ENABLE_AGENTS === "1"`), so EE can override the `@/plane-web` module with a real flag hook. Default OFF.

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export const useAgentsEnabled = (): boolean => process.env.NEXT_PUBLIC_ENABLE_AGENTS === "1";
```

- [ ] **Step 5: Mount `<AgentsRoot />`** in the workspace header. Locate the header used by workspace routes (search `apps/web/core/components` / `apps/web/app` for the top workspace header component) and render `<AgentsRoot workspaceId={...} />` in its right-hand cluster.

- [ ] **Step 6: Typecheck + commit**

```bash
cd apps/web && pnpm check:types
git add apps/web/ce/components/agents apps/web/ce/hooks/agents/use-agents-enabled.ts
git commit -m "feat(web): mount flag-gated agents pip + lazy panel under error boundary"
```

---

## Phase 4 — `apps/live` agent-events channel

### Task 15: Authenticated relay with coalescing

**Files:**

- Create: `apps/live/src/controllers/agent-events.controller.ts`
- Modify: `apps/live/src/server.ts` (register the route)
- Test: `apps/live/tests/agent-events.spec.ts`

**Interfaces:**

- Consumes: existing Redis client (`apps/live/src/redis.ts`), auth utilities (mirror the Hocuspocus `onAuthenticate` pattern in `apps/live/src`).
- Produces: a WS endpoint `/agent-events/:workspaceId` that authenticates the connection, subscribes to Redis channel `agent-events:{workspaceId}`, and relays events — coalescing `progress`/`step_updated` per run to ≤1 per 500ms, never dropping milestone events.

- [ ] **Step 1: Read the existing patterns** — `apps/live/src/redis.ts`, `apps/live/src/server.ts`, and the auth util used by Hocuspocus, to reuse the workspace-membership check and Redis client.

- [ ] **Step 2: Write failing test for the pure coalescer** — `apps/live/tests/agent-events.spec.ts`

```ts
import { describe, it, expect } from "vitest";
import { Coalescer } from "../src/controllers/agent-events.controller";

describe("Coalescer", () => {
  it("passes milestone events immediately", () => {
    const out: unknown[] = [];
    const c = new Coalescer((e) => out.push(e), 500);
    c.push({ runId: "r", sequence: 1, type: "status_changed", payload: {} });
    expect(out).toHaveLength(1);
  });

  it("collapses rapid progress to the latest on flush", () => {
    const out: any[] = [];
    const c = new Coalescer((e) => out.push(e), 500);
    c.push({ runId: "r", sequence: 1, type: "progress", payload: { percent: 10 } });
    c.push({ runId: "r", sequence: 2, type: "progress", payload: { percent: 40 } });
    expect(out).toHaveLength(0);
    c.flush();
    expect(out).toHaveLength(1);
    expect(out[0].payload.percent).toBe(40);
  });
});
```

- [ ] **Step 3: Run to verify fail** — `cd apps/live && pnpm vitest run agent-events` → FAIL.

- [ ] **Step 4: Implement the controller + `Coalescer`**

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

type Event = { runId: string; sequence: number; type: string; payload: unknown };

const COALESCED = new Set(["progress", "step_updated"]);

export class Coalescer {
  private pending = new Map<string, Event>();
  constructor(
    private emit: (e: Event) => void,
    private windowMs: number
  ) {}

  push(e: Event) {
    if (!COALESCED.has(e.type)) {
      this.emit(e);
      return;
    }
    this.pending.set(e.runId, e); // keep only the latest per run
  }

  flush() {
    for (const e of this.pending.values()) this.emit(e);
    this.pending.clear();
  }
}

// Route registration: authenticate the socket (workspace membership), create a
// Coalescer(send, 500) with a setInterval(() => coalescer.flush(), 500) cleared
// on close, subscribe to Redis `agent-events:{workspaceId}`, and forward each
// parsed message via coalescer.push(). See Step 5.
```

- [ ] **Step 5: Wire the WS route in `server.ts`** — add an upgrade handler for `/agent-events/:workspaceId` that: authenticates (reject 4001 on failure), instantiates `Coalescer(sendToSocket, 500)` + a 500ms flush interval, subscribes to the Redis channel, forwards `push`, and on socket close clears the interval + unsubscribes. Follow the existing `ws`/Redis usage in `redis.ts`.

- [ ] **Step 6: Run to verify pass** — `cd apps/live && pnpm vitest run agent-events` → PASS. Then `cd apps/live && pnpm check:types`.

- [ ] **Step 7: Commit**

```bash
git add apps/live/src/controllers/agent-events.controller.ts apps/live/src/server.ts apps/live/tests/agent-events.spec.ts
git commit -m "feat(live): add authenticated agent-events relay with coalescing"
```

---

## Phase 5 — integration verification

### Task 16: End-to-end with a mocked backend

**Files:**

- Create: `apps/web/ce/services/agents/agent.service.mock.ts` (a dev-only mock implementing `IAgentService` + a fake event emitter).

- [ ] **Step 1: Implement a mock service + fake stream** emitting a scripted run through `queued → running → awaiting_approval → succeeded`, wired behind `NEXT_PUBLIC_ENABLE_AGENTS=1` and a `?agents-mock=1` guard.

- [ ] **Step 2: Run the app** — use the `/run` skill (or `pnpm --filter web dev`) with `NEXT_PUBLIC_ENABLE_AGENTS=1`. Verify, observing real behavior:
  - Flag OFF (unset) → no pip, no network calls to `agent-*` (check devtools).
  - Flag ON → pip appears; opening the panel lists the scripted run; it advances live; approval shows inline Approve/Reject; Stop cancels; completion moves it to "Recently done" with no toast/modal.
  - Refresh mid-run → panel rehydrates to current state (durability).
  - Force a render error in a row (temporary throw) → "Agents unavailable" fallback, host app still usable (crash isolation).

- [ ] **Step 3: Full checks**

Run: `pnpm --filter @plane/agents test && cd apps/web && pnpm vitest run ce && pnpm check:types && cd ../live && pnpm vitest run`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/ce/services/agents/agent.service.mock.ts
git commit -m "test(web): add mock agent backend + e2e verification harness"
```

---

## Self-Review notes

- **Spec coverage:** contract (Tasks 1–5) · durable rehydrate (Task 3, hooks Task 9) · client-agnostic reducer (Phase 1, pure) · REST/commands (Task 6) · MobX adapter (Task 7) · transport + reconnect (Tasks 8–9) · lazy/gated connections (Tasks 9, 14) · hybrid UI panel+inline (Tasks 10–13) · ambient pip (Task 14) · error boundary + kill switch + lazy-load (Task 14) · live relay + coalescing (Task 15) · durability/crash-isolation verified (Task 16). Push notifications, fleet board, non-work-item targets = backlog, intentionally absent.
- **Known follow-ups to confirm during execution (not placeholders — real lookups):** exact `useStore` export name; `LIVE_BASE_URL` constant name; Plane token class names; work-item detail + workspace header mount points; `APIService` `get/post` return shape. Each is called out in the step where it matters.
- **Type consistency:** `applyEvent` / `reconcile` / `emptyAgentState` / `selectGroupedRuns` / `selectActiveCount` / `selectRunsForTarget` / `backoffDelay` / `AgentService` / `AgentStore` / `AgentEventTransport` names are used identically across tasks.
