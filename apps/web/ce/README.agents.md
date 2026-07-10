<!--
Copyright (c) 2023-present Plane Software, Inc. and contributors
SPDX-License-Identifier: AGPL-3.0-only
See the LICENSE file for details.
-->

# Agents — web adapter layer

The thin web-side adapters that connect Plane's React/MobX app to the
framework-free [`@plane/agents`](../../../packages/agents/src/state/README.md)
core. **Nothing here re-implements state logic** — it wires the pure reducer and
selectors to the UI, and owns only the I/O and lifecycle that the core
deliberately leaves out (sockets, polling, MobX observability, feature-flagging).

For the wider design see
[`docs/superpowers/specs/2026-07-10-agent-task-visibility-design.md`](../../../docs/superpowers/specs/2026-07-10-agent-task-visibility-design.md)
— especially "Client-agnostic core & durable state", "Scale, resilience &
performance", and "Feature flagging & safe rollout".

## The pieces & how they fit

| Layer              | File(s)                                     | Role                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Store**          | `store/agents/agent.store.ts`               | Thin MobX wrapper. Holds the reducer's projection as a single `observable.ref` and exposes async I/O. All state logic stays in `@plane/agents`.                                                       |
| **Service**        | `services/agents/agent.service.ts`          | REST request/response half — snapshot load, history, commands.                                                                                                                                        |
| **Transport**      | `transport/agents/agent-event-transport.ts` | WS event stream. Delivers parsed events; owns no reconnect/business logic; catches all socket errors.                                                                                                 |
| **Browser socket** | `transport/agents/browser-socket.ts`        | Adapts a native `WebSocket` to the transport's minimal socket surface.                                                                                                                                |
| **Hooks**          | `hooks/agents/*`                            | `use-agent-store` (accessor), `use-agents-enabled` (flag), `use-agent-subscription` (lazy live stream + reconnect), `use-agent-count` (ambient poll), `subscription-policy` (pure `shouldSubscribe`). |

## Data flow

```
listRuns snapshot ──▶ store.hydrate / reconcile
live events ──(transport)──▶ store.ingestEvent / applyEvent
                                      │
                                store.grouped (observable) ──▶ components

command: component ──▶ store.runCommand ──▶ service ──▶ (echoed back as an event)
```

Commands are **not** applied optimistically — the store reflects a change only
when the backend echoes the corresponding event back through the transport.

## Key properties

- **Lazy connections** — nothing opens on login. The flag is checked first
  (`use-agents-enabled`), and a socket opens only while a panel is actually
  watching (`shouldSubscribe` = flag on **and** something to watch). This bounds
  concurrent connections to engaged users. Flag-off = zero network footprint.
- **Ambient count is a poll, not a socket** — `use-agent-count` uses a cheap SWR
  poll (~45s). The ambient tier tolerates staleness; the socket is reserved for
  the active panel.
- **Durable** — the core is a projection of server-owned state. On reconnect and
  on tab-visible the client re-snapshots via `reconcile`, then resumes the
  stream, so no state is lost across drops.
- **No core edits** — wired additively via the CE root store
  (`store/root.store.ts`); EE overrides individual modules through the
  `@/plane-web` alias (e.g. a real flag service for `use-agents-enabled`).
- **Errors isolated** — all socket errors and malformed frames are caught in the
  transport, so nothing here can throw into React.
