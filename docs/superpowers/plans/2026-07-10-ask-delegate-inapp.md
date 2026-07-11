# In-App Ask/Delegate — Implementation Plan (v1)

**Status:** plan, pre-implementation
**Date:** 2026-07-10
**Scope:** CE-only. Edits are confined to `apps/web/ce/**`. No edits under `apps/web/core/**` or `packages/**` (read-only there).
**Relationship:** UI-completion for the [Agent Task Visibility plan](./2026-07-10-agent-task-visibility.md), driven by the [Agent Demo bridge](../../../packages/agents-demo/src/server.ts).

---

## Goal

Add the in-app UI to (a) **start** an agent run from inside the Agents dock and (b) **show its answer** on the completed row. Today a run is started only via `curl -X POST localhost:4000/dispatch -d '{"request":"…"}'`. After this change, a user opens the dock, types a request, presses Enter, the run appears via the existing 2500 ms poll, advances through its gate, and — once `succeeded` — its one-line answer (`run.result.summary`) renders on the row.

The Ask/Delegate **runtime already works end-to-end**. The only missing pieces are: one service method, one store action, one input component, one mount, and one answer block on the row.

### In scope

1. `AgentService.dispatch(request)` → `POST /dispatch`, returns `{ runId }`.
2. `AgentStore.dispatch(request)` → calls the service; the new run surfaces via the existing `loadRuns` poll.
3. `AgentDispatchInput` component (textarea + Send) mounted in the dock footer.
4. Mount in `agents-dock.tsx` footer.
5. Answer display: render `run.result.summary` on `succeeded` rows in `agent-run-row.tsx`.

### Out of scope (do NOT build)

- **Full streamed answer (token-by-token deltas).** The `@plane/agents` event contract has no per-token/delta event (`TAgentEventType` is `status_changed | progress | step_started | step_updated | step_completed | input_requested | approval_requested | completed | error` — see `packages/agents/src/types/events.ts:17`). The final answer arrives only in the terminal `completed` event's `result.summary` (a truncated one-liner). Streaming the full answer would require a new contract event **and** an SSE/WS transport — both outside CE and outside this feature. We render the terminal `result.summary` only. (Ref: pin #8.)
- Any backend/`packages/*` change, real-backend endpoints, or auth work.

---

## Architecture

```
AgentDispatchInput (dock footer, ce/components/agents/agent-dispatch-input.tsx)
      │  store.dispatch(request)
      ▼
AgentStore.dispatch  (ce/store/agents/agent.store.ts)
      │  this.service.dispatch(request)
      ▼
AgentService.dispatch  (ce/services/agents/agent.service.ts)  ──POST /dispatch {request}──►  agents-demo bridge (:4000)
                                                                                                     │ 202 {runId}
        the new run then surfaces on the next tick of the existing 2500 ms poll:
        AgentsPanel useEffect → store.loadRuns({workspaceId}) → service.listRuns → store.hydrate
      ▼
AgentRunRow (ce/components/agents/agent-run-row.tsx) renders run.result.summary once status === "succeeded"
```

The dispatch write path is **fire-and-forget from the UI's perspective**: it does not optimistically insert the run. The already-running 2500 ms poll in `AgentsPanel` (`agents-panel.tsx:30-34`) is the surfacing mechanism, exactly like every other run-state change in this feature.

---

## Tech stack

- React 18.3 + `mobx` / `mobx-react` (`observer`).
- `APIService` (axios wrapper) at `apps/web/core/services/api.service.ts` — `get(url, params?, config?)`, `post(url, data?, config?)` both return the raw axios response (read `res.data`). **Read-only** here; we only subclass it via the existing `AgentService`.
- `@plane/agents` contract types (`TAgentRun`, `TAgentResult`, `IAgentService`) — **read-only**.
- TypeScript strict, `exactOptionalPropertyTypes: true` (optional object fields must be typed `| undefined`).
- `oxlint` 1.51.0 with `react`, `typescript`, `promise`, `unicorn`, `import`, `jsx-a11y` plugins; categories `correctness`/`suspicious`/`perf` = warn. Watch: `no-await-in-loop`, `no-array-index-key`, `prefer-add-event-listener`, `no-floating-promises` (use `void fn()` for fire-and-forget), `no-unused-vars`.
- `vitest` for the CE store spec.

---

## Global constraints

- **Design tokens (this build resets Tailwind keyword sizes: `--text-*: initial`).** Use NUMERIC font sizes only: `text-13` (body), `text-11` (meta), `text-10` (chip). **Never** `text-sm` / `text-xs` / any `custom-*` — all dead in this build. Use semantic colors only: `text-primary`, `text-secondary`, `text-tertiary`, `text-placeholder`, `text-accent-primary`, `bg-surface-1`, `bg-surface-2`, `border-subtle`. Primary-action fill uses the theme var `var(--color-label-indigo-text)` (matches the existing Approve/Resume buttons in `agent-run-row.tsx`).
- **Focus ring on every interactive element:** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong` (the existing shared `FOCUS` constant / dock pattern).
- **`observer` only when a component reads observable store projection.** `AgentDispatchInput` calls an action but does not read `store.state`/`store.grouped`, so it is **not** an `observer`.
- **File header:** every new `.ts`/`.tsx` file starts with the 5-line license header used across the feature (copy verbatim from any sibling file).

---

## Verified findings (read first-hand — do NOT re-derive)

1. **Bridge — `packages/agents-demo/src/server.ts:172-178`.** `POST /dispatch` reads `{ request }`, returns **`202 { runId }`** on success (`400 {error:"missing request"}` if `request` is falsy). CORS is permissive: `Access-Control-Allow-Origin` echoes the request origin (`server.ts:104-108`), methods `GET, POST, OPTIONS`, credentials allowed, `OPTIONS` → `204`. Base URL is `http://localhost:4000` (`PLANE_AGENTS_PORT` default, `server.ts:37`).
   - ⚠️ **`runId` may be `""`.** `startDispatch` returns `runId` synchronously but it is only populated when `onRunStart` fires on the next tick (`server.ts:68-94`, comment at line 93: _"may be '' until onRunStart fires — the panel polls"_). **Therefore do not key any optimistic insert on the returned `runId`.** The poll is the reliable surfacing path.

2. **Service style — `apps/web/ce/services/agents/agent.service.ts`.** `AGENTS_API_BASE = import.meta.env.VITE_AGENTS_API_BASE || API_BASE_URL || "http://localhost:4000"`. `listRuns`/`getRun` call `this.get(url, { params })` and `return res.data`. `sendCommand` calls `this.post(url, body)` and returns `void`. **`dispatch` mirrors `sendCommand`'s `this.post` style but reads and returns `res.data`.**

3. **Contract type — `packages/agents/src/types/session.ts:79-85`.** `TAgentResult = { summary?: string; reviewUrl?: string }`, attached as `TAgentRun.result?` (`session.ts:110`). The Ask answer is **`run.result?.summary`** — a one-line string, present on terminal runs. The `completed` event carries `{ status, result? }` (`events.ts:60`) and the reducer merges it onto the run. `agent-run-row.tsx:145-149` already reads `run.result?.reviewUrl`; the answer block reads the sibling `run.result?.summary`.

4. **⚠️ Interface gap — `IAgentService` has no `dispatch`.** `IAgentService` (`packages/agents/src/services/index.ts`, read-only) declares only `listRuns`/`getRun`/`sendCommand`. The store field is typed `private service: IAgentService` (`agent.store.ts:40`) and the spec injects a plain mock `{ listRuns, getRun, sendCommand }` (`agent.store.spec.ts:24,32,45-49,57`). Because we cannot edit `packages/*`, we introduce a **CE-local** `IAgentDispatchService extends IAgentService` in the CE service file, retype the store field to it, and add `dispatch: vi.fn()` to the four spec mocks (the spec is CE, hence editable). This keeps everything type-safe with **no casts**.

5. **Store root construction — `apps/web/ce/store/root.store.ts:23`:** `this.agents = new AgentStore(this)` (no injected service → default `new AgentService()`). The default `AgentService` implements the new `IAgentDispatchService`, so `dispatch` is available at runtime in the app.

---

## Task 1 — Add `dispatch` to the service (+ CE-local interface)

**Files**

- Modify: `apps/web/ce/services/agents/agent.service.ts`

**Interfaces**

- Produces: `interface IAgentDispatchService extends IAgentService { dispatch(request: string): Promise<{ runId: string }> }`
- Produces: `AgentService.dispatch(request: string): Promise<{ runId: string }>`
- Consumes: `APIService.post(url, data?, config?)` (inherited; returns axios response, read `res.data`).

**Steps**

1. Change the type import line to bring in `IAgentService` as a base for the new local interface (it is already imported — no new import needed). The current import (line 8) is:

   ```ts
   import type { IAgentService, TAgentCommand, TAgentRun } from "@plane/agents";
   ```

   Leave it as-is.

2. Add the CE-local interface immediately **above** the `AgentService` class declaration (i.e. after the class doc-comment block that ends on line 20, before `export class AgentService`):

   ```ts
   /**
    * CE-local extension of the read-only `@plane/agents` `IAgentService`. Adds the
    * write-path used to START a run from the dock. Kept here (not in the package)
    * because the contract in `packages/agents` is frozen for this milestone.
    */
   export interface IAgentDispatchService extends IAgentService {
     /** Start an agent run from a free-text request. Resolves with the new run id
      *  (which the demo bridge may return empty until the run registers — the
      *  panel poll surfaces the run either way). */
     dispatch(request: string): Promise<{ runId: string }>;
   }
   ```

3. Change the class declaration (line 21) to implement the extended interface:

   ```ts
   export class AgentService extends APIService implements IAgentDispatchService {
   ```

4. Add the `dispatch` method as the last method of the class (after `sendCommand`, before the closing `}` on line 46). It mirrors `sendCommand`'s `this.post` style but returns `res.data`:

   ```ts
     async dispatch(request: string): Promise<{ runId: string }> {
       const res = await this.post(`/dispatch`, { request });
       return res.data;
     }
   ```

**Full expected file after Task 1** (for reference):

```ts
/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { IAgentService, TAgentCommand, TAgentRun } from "@plane/agents";
import { APIService } from "@/services/api.service";

// Agent runs come from the runtime bridge (demo) or a real backend later — set
// VITE_AGENTS_API_BASE to override. Defaults to the local bridge for the demo.
const AGENTS_API_BASE = import.meta.env.VITE_AGENTS_API_BASE || API_BASE_URL || "http://localhost:4000";

/**
 * REST adapter for agent runs. The event *stream* arrives via the transport;
 * this is the request/response half (initial load, history, commands).
 * Endpoints are provisional — the source can be a real backend or the demo
 * runtime's HTTP surface; the store doesn't care which.
 */
/**
 * CE-local extension of the read-only `@plane/agents` `IAgentService`. Adds the
 * write-path used to START a run from the dock. Kept here (not in the package)
 * because the contract in `packages/agents` is frozen for this milestone.
 */
export interface IAgentDispatchService extends IAgentService {
  /** Start an agent run from a free-text request. Resolves with the new run id
   *  (which the demo bridge may return empty until the run registers — the
   *  panel poll surfaces the run either way). */
  dispatch(request: string): Promise<{ runId: string }>;
}

export class AgentService extends APIService implements IAgentDispatchService {
  constructor(baseURL: string = AGENTS_API_BASE) {
    super(baseURL);
  }

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

  async dispatch(request: string): Promise<{ runId: string }> {
    const res = await this.post(`/dispatch`, { request });
    return res.data;
  }
}
```

---

## Task 2 — Add the `dispatch` action to the store

**Files**

- Modify: `apps/web/ce/store/agents/agent.store.ts`

**Interfaces**

- Consumes: `IAgentDispatchService.dispatch(request)` (from Task 1).
- Produces: `AgentStore.dispatch(request: string): Promise<{ runId: string }>`

**Steps**

1. The store already imports the concrete `AgentService` (line 24):

   ```ts
   import { AgentService } from "@/plane-web/services/agents/agent.service";
   ```

   Extend it to also import the CE-local interface **type**:

   ```ts
   import { AgentService, type IAgentDispatchService } from "@/plane-web/services/agents/agent.service";
   ```

2. Retype the private field (line 40) and constructor param (lines 42-45) from `IAgentService` to `IAgentDispatchService`. Change:

   ```ts
   private service: IAgentService;

   constructor(
     private root: unknown,
     service?: IAgentService
   ) {
     this.service = service ?? new AgentService();
   ```

   to:

   ```ts
   private service: IAgentDispatchService;

   constructor(
     private root: unknown,
     service?: IAgentDispatchService
   ) {
     this.service = service ?? new AgentService();
   ```

   `IAgentService` stays imported — it is still used by `loadRuns`'s `Parameters<IAgentService["listRuns"]>[0]` (line 99). Leave that line unchanged.

3. Add the `dispatch` action immediately **after** `runCommand` (after line 107, before the class-closing `}`). It does **not** mutate store state synchronously (the poll surfaces the run), so — exactly like `loadRuns`/`runCommand` — it is **not** listed in `makeObservable` and needs **no** `runInAction`:

   ```ts
     /** Start a run from a free-text request. The new run surfaces via the panel's
      *  2500ms `loadRuns` poll — no optimistic insert (the bridge may return an
      *  empty runId until the run registers, so we cannot reliably seed on it). */
     async dispatch(request: string): Promise<{ runId: string }> {
       return this.service.dispatch(request);
     }
   ```

4. **OPTIONAL — instant-feedback optimistic seed (do NOT implement unless product asks; clearly labeled optional).** If a "queued" placeholder is wanted before the next poll tick, replace the body above with the following. Note the caveat: the bridge's `runId` may be `""` (Finding 1), so this can briefly show a placeholder whose id the poll later reconciles under a different real id — acceptable only as a cosmetic hint. `reconcile` is already imported (line 11).

   ```ts
     async dispatch(request: string): Promise<{ runId: string }> {
       const { runId } = await this.service.dispatch(request);
       if (runId) {
         const nowIso = new Date().toISOString();
         runInAction(() => {
           this.state = reconcile(this.state, [
             {
               id: runId,
               agentKey: "ask",
               title: request,
               status: "queued",
               workspaceId: "",
               initiatedBy: "",
               createdAt: nowIso,
               updatedAt: nowIso,
             },
           ]);
         });
       }
       return { runId };
     }
   ```

   (`runInAction` is already imported on line 7.) **Default plan uses the non-optimistic version from step 3.**

---

## Task 3 — Update the store spec for the widened interface

**Files**

- Modify: `apps/web/ce/store/agents/agent.store.spec.ts`

**Why:** `tsc --noEmit` type-checks the spec. The four mocks passed to `new AgentStore(...)` are now checked against `IAgentDispatchService`, which requires a `dispatch` member. Add `dispatch: vi.fn()` to each, and add one delegation test.

**Steps**

1. In the two inline mocks (lines 24 and 32), add `dispatch: vi.fn()`. Each currently reads:

   ```ts
   const store = new AgentStore({}, { listRuns: vi.fn(), getRun: vi.fn(), sendCommand: vi.fn() });
   ```

   Change **both** occurrences to:

   ```ts
   const store = new AgentStore({}, { listRuns: vi.fn(), getRun: vi.fn(), sendCommand: vi.fn(), dispatch: vi.fn() });
   ```

2. In the `loadRuns` test's named service (lines 45-49), add `dispatch`:

   ```ts
   const service = {
     listRuns: vi.fn().mockResolvedValue({ runs: [run("a")] }),
     getRun: vi.fn(),
     sendCommand: vi.fn(),
     dispatch: vi.fn(),
   };
   ```

3. In the `runCommand` test's named service (line 57), add `dispatch`:

   ```ts
   const service = {
     listRuns: vi.fn(),
     getRun: vi.fn(),
     sendCommand: vi.fn().mockResolvedValue(undefined),
     dispatch: vi.fn(),
   };
   ```

4. Add a delegation test as the last `it` block inside the `describe` (before the closing `});` on line 64):

   ```ts
   it("dispatch delegates to the service and returns the runId", async () => {
     const service = {
       listRuns: vi.fn(),
       getRun: vi.fn(),
       sendCommand: vi.fn(),
       dispatch: vi.fn().mockResolvedValue({ runId: "r1" }),
     };
     const store = new AgentStore({}, service);
     const result = await store.dispatch("What is in flight?");
     expect(service.dispatch).toHaveBeenCalledWith("What is in flight?");
     expect(result).toEqual({ runId: "r1" });
   });
   ```

---

## Task 4 — Create the dock input component

**Files**

- Create: `apps/web/ce/components/agents/agent-dispatch-input.tsx`

**Interfaces**

- Consumes: `useAgentStore(): AgentStore` (from `@/plane-web/hooks/agents/use-agent-store`), specifically `store.dispatch(request)`.
- Produces: `export const AgentDispatchInput: () => JSX.Element` (prop-less — `store.dispatch` takes only `request`; no `workspaceId` needed).

**Design notes**

- **Not an `observer`** — it only calls an action; it reads no observable projection.
- Enter submits, Shift+Enter inserts a newline. Disabled while the trimmed value is empty or a submit is in flight. Clears on successful submit.
- Fire-and-forget click/keydown handlers use `void submit()` to satisfy `promise/no-floating-promises`.
- Tokens + focus ring per Global Constraints. Send button uses the indigo primary fill matching `agent-run-row.tsx`.

**Steps**

1. Create the file with this exact content:

   ```tsx
   /**
    * Copyright (c) 2023-present Plane Software, Inc. and contributors
    * SPDX-License-Identifier: AGPL-3.0-only
    * See the LICENSE file for details.
    */

   import { useState } from "react";
   import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";

   // Shared focus ring — keyboard parity with the rest of the dock. (#10)
   const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

   /**
    * Dock-footer composer: type a request → START a run via `store.dispatch`.
    * The new run surfaces on the next tick of the panel's 2500ms `loadRuns` poll,
    * so there is no optimistic insert here. Not an `observer` — it calls an action
    * but reads no observable store state.
    */
   export const AgentDispatchInput = () => {
     const store = useAgentStore();
     const [value, setValue] = useState("");
     const [submitting, setSubmitting] = useState(false);

     const trimmed = value.trim();
     const disabled = trimmed.length === 0 || submitting;

     const submit = async () => {
       if (trimmed.length === 0 || submitting) return;
       setSubmitting(true);
       try {
         await store.dispatch(trimmed);
         setValue("");
       } finally {
         setSubmitting(false);
       }
     };

     return (
       <div className="border-subtle bg-surface-1 shrink-0 border-t p-3">
         <textarea
           value={value}
           onChange={(e) => setValue(e.target.value)}
           onKeyDown={(e) => {
             if (e.key === "Enter" && !e.shiftKey) {
               e.preventDefault();
               void submit();
             }
           }}
           rows={2}
           placeholder="Ask or delegate a task…"
           disabled={submitting}
           aria-label="Ask or delegate a task"
           className={`text-13 text-primary placeholder:text-placeholder bg-surface-2 border-subtle w-full resize-none rounded border px-2.5 py-1.5 ${FOCUS}`}
         />
         <div className="mt-2 flex items-center justify-between">
           <span className="text-11 text-tertiary">Enter to send · Shift+Enter for newline</span>
           <button
             type="button"
             onClick={() => void submit()}
             disabled={disabled}
             className={`text-11 min-h-8 rounded px-2.5 py-1 font-medium text-white disabled:opacity-50 ${FOCUS}`}
             style={{ backgroundColor: "var(--color-label-indigo-text)" }}
           >
             {submitting ? "Sending…" : "Send"}
           </button>
         </div>
       </div>
     );
   };
   ```

---

## Task 5 — Mount the input in the dock footer

**Files**

- Modify: `apps/web/ce/components/agents/agents-dock.tsx`

**Interfaces**

- Consumes: `AgentDispatchInput` (Task 4).

**Steps**

1. Add the import next to the other local component imports (after line 13, `import { AgentsHeaderPip } from "./agents-header-pip";`):

   ```ts
   import { AgentDispatchInput } from "./agent-dispatch-input";
   ```

2. Mount it as a `shrink-0` footer sibling **after** the scroll-body `<div className="min-h-0 flex-1">…</div>` and **before** the closing `</aside>`. The component supplies its own `shrink-0` + top border, so the flex column becomes: fixed header · flex-1 scroll body · fixed footer composer. Change:

   ```tsx
           <div className="min-h-0 flex-1">
             <Suspense fallback={<div className="text-11 text-placeholder p-4">Loading…</div>}>
               <AgentsPanel workspaceId={workspaceSlug} />
             </Suspense>
           </div>
         </aside>
   ```

   to:

   ```tsx
           <div className="min-h-0 flex-1">
             <Suspense fallback={<div className="text-11 text-placeholder p-4">Loading…</div>}>
               <AgentsPanel workspaceId={workspaceSlug} />
             </Suspense>
           </div>
           <AgentDispatchInput />
         </aside>
   ```

   (The `<aside>` already gates on `workspaceSlug` at line 38, so the composer only renders when a workspace is present.)

---

## Task 6 — Render the answer on succeeded rows

**Files**

- Modify: `apps/web/ce/components/agents/agent-run-row.tsx`

**Interfaces**

- Consumes: `run.result?.summary` (`TAgentResult.summary`, `session.ts:81`).

**Steps**

1. Insert an answer block **between** the `running` step-count block (ends line 91) and the action-buttons `<div className="mt-2 flex flex-wrap gap-1.5">` (line 95). It renders only for `succeeded` runs that carry a summary:

   ```tsx
   {
     /* Ask/Delegate ANSWER: the terminal one-line result. Full streamed answer
             (token deltas) is out of scope — the contract has no delta event. (#8) */
   }
   {
     run.status === "succeeded" && run.result?.summary && (
       <div className="text-13 text-secondary bg-surface-2 border-subtle mt-2 rounded border p-2">
         {run.result.summary}
       </div>
     );
   }
   ```

   Placement — the region becomes:

   ```tsx
         {run.status === "running" && steps > 0 && (
           // Named steps, not a percent bar (per the design's status model).
           <div className="text-placeholder mt-1.5 text-11" aria-live="polite">
             step {done} of {steps}
           </div>
         )}

         {/* Ask/Delegate ANSWER: the terminal one-line result. Full streamed answer
             (token deltas) is out of scope — the contract has no delta event. (#8) */}
         {run.status === "succeeded" && run.result?.summary && (
           <div className="text-13 text-secondary bg-surface-2 border-subtle mt-2 rounded border p-2">
             {run.result.summary}
           </div>
         )}

         {/* Recovery: Pause is the non-destructive default; Cancel is secondary and
             deferred behind an Undo (onRequestCancel/onUndoCancel). */}
         <div className="mt-2 flex flex-wrap gap-1.5">
   ```

   The existing `run.result?.reviewUrl` link inside the buttons row (lines 145-149) is unchanged — a succeeded run may show both the answer block and the "Review changes →" link.

---

## Verification

Run from repo root `/Users/mattgawarecki/projects/plane`.

1. **Types (must exit 0):**

   ```bash
   pnpm --filter web exec tsc --noEmit
   ```

   Expected: no output, exit code 0. (Confirms the widened `IAgentDispatchService`, the store retype, the spec mocks, and the new components all type-check under strict + `exactOptionalPropertyTypes`.)

2. **Lint (must report 0 warnings / 0 errors):**

   ```bash
   npx oxlint apps/web/ce/components/agents apps/web/ce/store/agents apps/web/ce/services/agents
   ```

   Expected: `Found 0 warnings and 0 errors.` (or equivalent), exit code 0. Specifically confirm no `promise/no-floating-promises` (the `void submit()` guards), no `no-unused-vars` (the prop-less component takes no unused args), no `jsx-a11y` issues (textarea has `aria-label`, button has text).

3. **Store unit tests (must pass):**

   ```bash
   pnpm --filter web exec vitest run apps/web/ce/store/agents/agent.store.spec.ts
   ```

   Expected: all tests pass, including the new `"dispatch delegates to the service and returns the runId"`.

4. **Manual end-to-end (demo bridge running on :4000, web on :3000, agents flag ON):**
   1. Start the bridge: `PLANE_PROJECT_ID=<id> pnpm --filter @plane/agents-demo exec tsx src/server.ts` (log shows `▷ agents bridge on http://localhost:4000`).
   2. In the web app, open the Agents dock (header pip).
   3. Confirm the composer renders pinned at the dock footer (below the scrollable run list).
   4. Type `What is in flight?` and press **Enter** (verify Shift+Enter inserts a newline instead of sending; verify Send is disabled while the field is empty and while "Sending…").
   5. Within ~2.5 s a new run appears in the list (via the poll) and advances (Queued → Running).
   6. When the run reaches its gate (`awaiting_approval`), click **Approve**.
   7. On completion the row shows the `succeeded` chip and the **answer block** with `run.result.summary` beneath the title.

---

## Task summary

| #   | Task                                              | Files                                           | Type   |
| --- | ------------------------------------------------- | ----------------------------------------------- | ------ |
| 1   | `AgentService.dispatch` + `IAgentDispatchService` | `ce/services/agents/agent.service.ts`           | Modify |
| 2   | `AgentStore.dispatch` action + field retype       | `ce/store/agents/agent.store.ts`                | Modify |
| 3   | Spec mocks + delegation test                      | `ce/store/agents/agent.store.spec.ts`           | Modify |
| 4   | `AgentDispatchInput` component                    | `ce/components/agents/agent-dispatch-input.tsx` | Create |
| 5   | Mount in dock footer                              | `ce/components/agents/agents-dock.tsx`          | Modify |
| 6   | Answer block on succeeded rows                    | `ce/components/agents/agent-run-row.tsx`        | Modify |

**6 tasks. 1 file created, 5 modified. All under `apps/web/ce/**`.\*\*

```

```
