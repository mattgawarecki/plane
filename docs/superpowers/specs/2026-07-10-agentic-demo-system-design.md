# Agentic Demo System — Design

**Status:** approved design, pre-implementation
**Date:** 2026-07-10
**Builds on:**

- `docs/superpowers/specs/2026-07-10-agent-task-visibility-design.md` (the panel + `@plane/agents` contract)
- `docs/superpowers/plans/2026-07-10-agent-demo-simulator.md` (Plane API client + run-journal + scenarios)

## Goal

A live, on-stage demo of "an agentic Plane": the user types a natural-language
request, a **real LLM** interprets it, acts on Plane through tools, and the work
streams into the visibility panel — watchable, steerable, and gated where it
matters. Optimized for one engaging end-to-end arc, not breadth.

**The demo arc:** type _"Ship the September billing close"_ → the agent
decomposes it into scoped sub-tasks (descriptions, assignees) live in the panel →
it proposes an irreversible cleanup that **halts for approval** → the presenter
approves → done. Plus an **Ask** aside (_"what's in flight for billing?"_)
answered in words.

## The realization: one system, not three

Choosing a real LLM (over scripted) collapses three separate workstreams into a
single pipeline. The pre-supposed backend from the visibility spec **becomes
real** (demo-scoped): the LLM runtime _is_ the orchestrator.

```
Dispatch input (new)  →  LLM runtime (new)  →  run-event journal  →  Visibility panel (existing)
   NL text                Tool Runner loop       TAgentRun / TAgentEvent    displays the run live
                          + Plane API tools
                          (reuses the simulator's client)
```

The runtime reuses the simulator's thin Plane API client and emits the same
`TAgentRun` / `TAgentEvent` journal the panel already consumes. We build one
pipeline that lights up all three surfaces.

## Interaction modes (priority order)

1. **Ask** (read-only) — _"what's in flight for billing?"_, _"top priority?"_.
   Cheapest, first, de-risks the live LLM before it mutates anything. Answered in
   words, rendered inline.
2. **Delegate** (create) — turn a request into structured work: sub-tasks with
   descriptions, estimates, assignments. The core "wow".
3. **Inform** (gated mutation) — **stretch**, only after 1 + 2. _"September
   invoices are done"_ → finds + closes matching items, **behind an approval
   gate**.

## Architecture

### Runtime (grounded in the Anthropic SDK)

- **Harness:** the SDK **Tool Runner** — `client.beta.messages.toolRunner(...)`
  (`@anthropic-ai/sdk`). The SDK drives the plan → call → loop cycle; we write
  only the tool functions. TypeScript/Node (aligns with `apps/live` and the
  simulator).
- **Model:** `claude-opus-4-8`, `thinking: {type: "adaptive"}`,
  `output_config: {effort: "high"}` (or `"xhigh"` for the decomposition turn).
- **Latency escape hatch:** Opus 4.8 fast mode (`speed: "fast"`, beta
  `fast-mode-2026-02-01`, via `client.beta.messages`) if live pacing drags — same
  model, higher tokens/sec.

### Tools (`betaZodTool`, prescriptive descriptions)

Opus 4.8 under-reaches for tools without explicit "call this when…" descriptions,
so each tool description states its trigger condition.

| Mode                 | Tool                                                                    | Notes                     |
| -------------------- | ----------------------------------------------------------------------- | ------------------------- |
| Ask (read)           | `searchWorkItems`, `getCycle`, `listByAssignee`                         | no mutation               |
| Delegate (write)     | `createWorkItem`, `createSubIssue`, `assign`, `setStatus`, `addComment` | the decomposition surface |
| Inform (destructive) | `bulkClose`                                                             | **gated** (see below)     |

Tools wrap the simulator's Plane API client (token REST, `X-Api-Key`,
localhost-guarded).

### Human-in-the-loop = tool-gating

Per SDK guidance, gate destructive actions **inside the tool's `run` function**.
`bulkClose.run` does not execute immediately: it emits an `approval_requested`
event, pauses, and executes only when the panel's **Approve** resolves it (the
`approve` command). Reject → the tool returns a "declined" result and the agent
adapts. **Our approval-gate UX is the LLM's safety rail** — this is why the gate
mattered in the visibility design.

### Progress → journal → panel

The Tool Runner streams; each tool call maps to a run step and emits a
`TAgentEvent` on the journal. For the demo, the journal can stream **SSE directly
from the runtime** to the client (skip the full `apps/live` Redis relay — see
triage). The panel renders the run exactly as designed.

### Contract mapping

| Runtime concept        | `@plane/agents` type                              |
| ---------------------- | ------------------------------------------------- |
| one dispatched request | a `TAgentRun` (`agentKey: "dispatch"`)            |
| each tool call         | a `TAgentStep` + `step_*` event                   |
| gated `bulkClose`      | `approval_requested` → `approve`/`reject` command |
| final answer / summary | `completed` event + `TAgentResult.summary`        |
| Ask answer             | rendered inline from the run's result text        |

### Where code lives

- Runtime + tools: extend `@plane/agents-demo` (or a sibling private package) —
  private, non-shipped, localhost-guarded.
- Dispatch input UI: a **responsive dispatch surface** — same core (composer +
  run list), two presentations:
  - **Wide screens → docked at the bottom of the Agents panel**
    (`agent-dispatch.tsx` rendered inside `agents-panel.tsx`). One surface: the
    pip opens the panel, runs stream in the list, the composer sits at the bottom;
    Ask answers and Delegated runs both render as entries in the same list. This
    is the primary demo surface. Follows the bottom-dispatch pattern (Claude Agent
    View).
  - **Mobile / narrow / native → a full-screen single-purpose surface** brought up
    _over_ the current view and dismissible back to it. Where screen real estate
    is at a premium, a focused dispatch UI beats an in-chrome panel; this is also
    the natural presentation for a future native companion app. Same composer +
    run-list component, different container (full-screen sheet vs docked drawer)
    — chosen by breakpoint/platform.

  Both presentations share the dispatch logic and render the identical run
  entries; only the container differs. Wired via the `@/plane-web` alias, behind
  the same feature flag as the panel.

## Triage — what we build vs defer (max demo impact under time)

**Critical path (build):**

- Dispatch input (small UI: one field, submit).
- LLM runtime + Tool Runner + the ~6 read/write tools above.
- Run-journal → panel, thin (render the single run the arc drives).
- One gated `bulkClose` → Approve/Reject in the panel.
- Ask path: read tools + inline text answer.

**Cut / defer for the demo (keep in the plans, don't build now):**

- Inline work-item indicator.
- Reconnect/backoff hardening, ambient-count poll, error-boundary polish.
- The full `apps/live` coalescing relay — demo streams SSE straight from the
  runtime instead.
- Fleet board, notifications, non-work-item targets.
- Non-demo robustness of the visibility v1 plan.

The panel only needs to render the one run the arc drives — everything else in
the visibility plan stays queued.

## Risk mitigations (real LLM on stage)

1. **Approval-gated destructive tools** — the LLM cannot close/delete without a
   human tap; the gate is enforced in the tool `run` function, not just the UI.
2. **Scripted fallback** — the simulator's canned scenarios stay as a backup demo
   if the live agent flails.
3. **Tight rails system prompt** + fixed, rehearsed **seed data** (see the seed
   task) so the agent operates in a known world.
4. **Fast mode** available if latency drags.
5. **Read-first ordering** — Ask (no mutation) demoed before Delegate builds
   confidence the interpretation is right.

## Testing / verification

- **Tools** are unit-testable in isolation (mock the Plane client; assert the
  right REST calls) — same approach as the simulator.
- **The LLM loop is not deterministically unit-testable.** Verify by rehearsal
  against seeded local data with a fixed prompt; keep the scripted fallback as the
  safety net. Gate correctness (approve/reject) is testable via the tool `run`
  function independent of the model.
- **Localhost guard + dry-run** carry over from the simulator — the runtime never
  runs against a non-local instance.

## Open assumptions

- Reuses the simulator's Plane API client + run-journal (Task in the simulator
  plan). If that package isn't built yet, this system builds it first.
- Demo runs against seeded local data in workspace `klarity`.
- SSE-direct transport is acceptable for the demo (production would use the
  `apps/live` relay from the visibility spec).

## Backlog (post-demo)

- Wire the runtime's events through the real `apps/live` relay instead of SSE.
- Inform mode graduated out of "stretch" with a full confirmation UX.
- Steering (`correct`) mid-run through the dispatch input.
- Multi-run concurrency + the fleet board.
- Move off demo-seed data to real workspace content.
