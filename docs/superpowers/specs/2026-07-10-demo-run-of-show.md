# Agentic Plane — Demo Cheat-Sheet

Live agent driving a real local Plane. Low-stakes, repeatable — glance at this while you run it.

**Real vs prototype:** the live agent runs in a **terminal** (prints steps + an answer) and makes **real** reads/writes to Plane at `localhost:3000` — the gate is enforced inside the tool, so it can't close anything without approval. The **panel / dispatch HTML mockups** are the _envisioned UI_, shown separately — they're not wired to the runtime.

## Pre-flight

- Local Plane up: API `:8000`, web `:3000`. `.env.demo` at repo root (auto-loaded).
- Seed once (idempotent): `pnpm --filter @plane/agents-demo exec tsx src/seed-cli.ts`
- Browser: Plane web on the **Agent Demo** project. Optional: open the 3 prototype HTML files as "the vision."
- Big terminal font.

```
PROJECT=40e55ecc-cbc7-4f61-9cde-a7a59b16a73c
```

## The three beats (in order)

**1 · Ask** — read-only, safe opener. Agent enumerates + prioritizes.

```
PLANE_PROJECT_ID=$PROJECT pnpm --filter @plane/agents-demo exec tsx src/dispatch-cli.ts \
  "What's in flight right now? Give me a short prioritized summary."
```

→ calls `list_work_items`, returns a prioritized read (flags the urgent webhook item; notes the epic stuck in backlog).

**2 · Delegate** — writes. Cut to the Plane UI after to show the new sub-tasks appear.

```
PLANE_PROJECT_ID=$PROJECT pnpm --filter @plane/agents-demo exec tsx src/dispatch-cli.ts \
  "Break down the 'September billing close' epic into a set of well-scoped sub-tasks and create them."
```

→ creates 5 scoped sub-tasks under the epic.

**3 · Gate** — the climax. Pause on `⚑ approval_requested`, say "a live model, gated — it can't do this alone," then it closes the 4 August items.

```
AGENT_APPROVE=yes PLANE_PROJECT_ID=$PROJECT pnpm --filter @plane/agents-demo exec tsx src/dispatch-cli.ts \
  "My team finished the entire August close — every 'August close' item is done and superseded. Close them out."
```

→ 4 "August close" items → `cancelled` (verify in the Plane UI).

- Approval: `AGENT_APPROVE=yes|no` forces it (rehearsed run). Interactive terminal → `[y/N]` prompt. No TTY + no override → **default-deny** (safe — a good beat to show too).

## Reset between runs

Delete the **Agent Demo** project in Plane, then re-seed (the seed skips unless the project is gone):

```
pnpm --filter @plane/agents-demo exec tsx src/seed-cli.ts
```

## If a live call stalls or goes off-script

Re-run the exact command above (they're the tested prompts). Nothing destructive happens without approval. Worst case, walk the story on the prototype mockups (no network needed).
