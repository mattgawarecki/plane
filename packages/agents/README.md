# @plane/agents

Shared contracts and framework-agnostic logic for **agentic task visibility and
control** in Plane — the seam between spun-off agent runs (built separately) and
the Plane UI that observes and steers them.

> **Status: stub / provisional.** Only the data + behavior contracts and the
> service/transport interfaces exist so far. Stores and UI components are
> intentionally deferred until the design is settled — see
> `docs/superpowers/specs/` for the design in progress. Field names and the
> status set may still change.

## Why a separate package

Keeps agent-visibility code compartmentalized away from the core apps. It is
consumed via the `workspace:*` protocol and exposes only its `exports` surface,
so the wiring to a specific UI surface or real-time transport is decided by
consumers, not baked in here.

## What's in here

| Area               | File(s)                 | Purpose                                                        |
| ------------------ | ----------------------- | -------------------------------------------------------------- |
| Data contract      | `src/types/session.ts`  | `TAgentRun`, status model, steps, progress, result, error      |
| Real-time contract | `src/types/events.ts`   | `TAgentEvent` envelope pushed over the transport               |
| Behavior contract  | `src/types/commands.ts` | `TAgentCommand` — interrupt / steer / answer / approve / retry |
| Request surface    | `src/services/`         | `IAgentService` — list/get runs, send commands (mockable)      |
| Real-time seam     | `src/transport/`        | `IAgentEventTransport` — SSE / WS / polling, chosen later      |

Consumers mock `IAgentService` / `IAgentEventTransport` freely in tests; no live
agent runtime is required.

## Build

Follows the standard `@plane/*` toolchain (tsdown + oxlint/oxfmt):

```bash
pnpm --filter @plane/agents build
pnpm --filter @plane/agents check:types
```
