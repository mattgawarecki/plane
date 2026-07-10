# Open questions — to revisit (pinned, not yet decided)

Parked mid-implementation. Each has a quick lean; none blocks current work.

1. **Two tabs, same user, both engaging.** Today each tab has its own `AgentStore`
   (own socket, own poll) — no cross-tab coordination. Duplicate connections +
   duplicate approval prompts possible. Lean: SharedWorker or `BroadcastChannel`
   to share one socket + dedupe prompts across tabs (already in the visibility
   backlog). The reducer's `sequence` dedup means correctness holds either way;
   this is about waste + double-prompting, not correctness.

2. **Conflicting actions (one or more users).** Server is the source of truth;
   the client is a projection, so conflicts resolve server-side and the client
   reconciles via `sequence` + snapshot refetch. Open: what the _UX_ should be
   when two people approve/reject the same gate, or steer the same run — last
   write wins silently, or surface "someone else acted"? Needs a product call +
   maybe an event that says who resolved a gate.

3. **UI bog-down under load.** Known levers already noted: server-side coalescing
   of progress events, collapse step logs by default, MobX fine-grained observers,
   list virtualization deferred until the fleet board. Watch: many concurrent
   runs re-rendering the panel; a chatty run flooding `step_*`. Revisit coalescing
   cadence + virtualization when run counts grow.

4. **Where relaxed latency is fine (spend less).** Good candidates:
   - The ambient header count — already a 30–60s poll, not a live stream.
   - The live pulse / animations — `requestAnimationFrame`, and drop under
     `prefers-reduced-motion`.
   - Progress bars / step meters — batch/throttle updates (a few Hz is plenty; no
     need for every event to paint).
   - "Recently done" list — can lag; only the blocked/needs-you state must feel
     immediate. Prioritize freshness for the attention tier, relax it elsewhere.
