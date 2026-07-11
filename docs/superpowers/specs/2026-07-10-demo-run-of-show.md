# Agentic Plane — Demo Cheat-Sheet

Live agent driving a real local Plane. Low-stakes, repeatable — glance at this while you run it.

**What's real:** a live model (Opus 4.8, Tool Runner) makes **real** reads/writes to Plane, and the **gate is enforced inside the tool** — it can't close anything without approval. Two ways to show it:

- **Terminal track** — the agent prints steps + an answer in a terminal. Fast, no browser, bulletproof fallback.
- **Live-panel track** — the same runs stream into the **web Agents panel** (the dock), and the gate surfaces as an in-UI **Approve/Reject** button. This is the money shot; the terminal is the safety net.

Ports: Plane web `:3000`, Plane API `:8000`, agents bridge `:4000`.

```
PROJECT=40e55ecc-cbc7-4f61-9cde-a7a59b16a73c
```

## Pre-flight (both tracks)

- Local Plane up (web `:3000`, API `:8000`). `.env.demo` at repo root (auto-loaded; holds `PLANE_*` + `ANTHROPIC_API_KEY`).
- Seed once (idempotent): `pnpm --filter @plane/agents-demo exec tsx src/seed-cli.ts`
- Big terminal font.

## Pre-flight (live-panel track only)

1. **Flag on.** `apps/web/.env.local` (gitignored) contains:
   ```
   VITE_ENABLE_AGENTS=1
   VITE_AGENTS_API_BASE=http://localhost:4000
   ```
   If you just created/edited it, **restart** `pnpm --filter web dev` (Vite reads env at start).
2. **Start the bridge** (serves runs + accepts commands on `:4000`):
   ```
   PLANE_PROJECT_ID=$PROJECT pnpm --filter @plane/agents-demo exec tsx src/server.ts
   ```
   `curl -s localhost:4000/health` → `{"ok":true}`.
3. **Open the dock.** Browse Plane to a workspace page → click the **Agents** pip (top-right) → the panel slides in as a rounded side-panel.
   - ⚠️ **Gotcha:** the bridge serves one workspace (its `cfg.workspace`, from `loadConfig`/`.env.demo`). The panel fetches `/api/workspaces/<url-slug>/agent-runs/`, so the **workspace slug in your browser URL must match the bridge's workspace** — otherwise the panel stays empty (404). Set them to the same slug.

## The three beats (in order)

Each beat can be driven **either** way. Terminal = `dispatch-cli.ts`. Live-panel = `curl` to the bridge; the run appears in the dock within ~2.5s (poll) and advances live.

**1 · Ask** — read-only, safe opener. Agent enumerates + prioritizes.

- Terminal:
  ```
  PLANE_PROJECT_ID=$PROJECT pnpm --filter @plane/agents-demo exec tsx src/dispatch-cli.ts \
    "What's in flight right now? Give me a short prioritized summary."
  ```
- Live-panel:
  ```
  curl -s localhost:4000/dispatch -d '{"request":"What is in flight right now? Give me a short prioritized summary."}'
  ```
  → run surfaces → advances → lands `succeeded`; the answer shows as the row summary.

→ calls `list_work_items`, returns a prioritized read (flags the urgent webhook item; notes the epic stuck in backlog).

**2 · Delegate** — writes. Cut to the Plane UI after to show the new sub-tasks appear.

- Terminal:
  ```
  PLANE_PROJECT_ID=$PROJECT pnpm --filter @plane/agents-demo exec tsx src/dispatch-cli.ts \
    "Break down the 'September billing close' epic into a set of well-scoped sub-tasks and create them."
  ```
- Live-panel:
  ```
  curl -s localhost:4000/dispatch -d '{"request":"Break down the September billing close epic into well-scoped sub-tasks and create them."}'
  ```

→ creates 5 scoped sub-tasks under the epic.

**3 · Gate** — the climax. The `bulk_close` tool blocks on approval.

- Terminal (rehearsed): `AGENT_APPROVE=yes` forces it; interactive TTY → `[y/N]` prompt; no TTY + no override → **default-deny** (a good beat to show too).
  ```
  AGENT_APPROVE=yes PLANE_PROJECT_ID=$PROJECT pnpm --filter @plane/agents-demo exec tsx src/dispatch-cli.ts \
    "My team finished the entire August close — every 'August close' item is done and superseded. Close them out."
  ```
- **Live-panel (the money shot):**
  ```
  curl -s localhost:4000/dispatch -d '{"request":"My team finished the entire August close — every August close item is done and superseded. Close them out."}'
  ```
  → the run enters **"Needs you"** at the top of the panel with an **Approve / Reject** button. Say _"a live model, gated — it can't do this alone."_ Click **Approve** → it closes the 4 August items.

→ 4 "August close" items → `cancelled` (verify in the Plane UI).

## Extra beats the panel now shows (optional color)

- **Pause / Resume** a running run — reflects **instantly** (optimistic), reconciles on the next poll.
- **Cancel** a paused/queued run — a **draining fill** sweeps the Undo button over 5s; click to undo (guaranteed while visible). Let it run out to commit.
- **Clear all** / per-row ✕ in "Recently done" to tidy the list.

## Reset between runs

Delete the **Agent Demo** project in Plane, then re-seed (the seed skips unless the project is gone):

```
pnpm --filter @plane/agents-demo exec tsx src/seed-cli.ts
```

## If a live call stalls or goes off-script

- Re-run the exact command (they're the tested prompts). Nothing destructive happens without approval.
- Panel empty? Check `curl :4000/health`, the flag/restart, and the **workspace-slug match** gotcha above.
- Worst case, drop to the **terminal track** — same runtime, no browser, always works.

## In-panel trigger (now built)

You can start Ask/Delegate **without the terminal**: open the dock → type in the **footer composer** → **Enter** (Shift+Enter = newline). The run surfaces via the poll, advances, hits the gate, and — once `succeeded` — its one-line answer renders on the row. `curl`/CLI still work and remain the bulletproof fallback.

## Not yet built (say if asked)

- **Streamed answer** — the answer appears whole (the terminal `result.summary` one-liner), not token-by-token. Token streaming needs a new contract event (pin #8).
- **Real-time transport** — the panel polls (2.5s) today; the WebSocket client is built but off, SSE is the planned upgrade. Feels live enough at demo scale.
