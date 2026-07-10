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

## Round 2

5. **Bulk-dismiss completions.** The "Recently done" group should have a "Clear
   all" (and per-row dismiss). Needs a `dismissed` concept — client-local hidden
   set at minimum, or a real dismiss command if it should persist/sync. Lean:
   client-local first, promote to a command if cross-device.

6. **Virtualization (elevate from backlog).** The panel currently maps every run;
   long lists should virtualize. Plane already virtualizes issue lists — reuse
   that (`react-window`/equivalent) rather than roll our own. Do this before the
   fleet board / any high-count view.

7. **Correlated / dependent runs (sub-agents).** A running agent may spawn child
   runs; today `TAgentRun` has `target` (an entity) but no run→run relation.
   Add an optional `parentRunId` (+ maybe `relationType`) and render nested/
   threaded (cf. Devin child-Devins, Claude subagent panel). Contract extension —
   design before building. Ties to how the demo runtime would expose sub-agents.

8. **Streaming the ask/delegate answer (table stakes).** Step events (`step_*`)
   already stream incrementally, but the final NL _answer_ is delivered whole
   (the CLI dispatch returns the final message). Add token/delta streaming for the
   answer (the Tool Runner supports it) so responses render live, not after a
   pause. Needs an `answer`/message-delta event on the contract + incremental
   render in the panel/dispatch.

9. **Render efficiency / avoid needless re-renders.** `AgentRunRow` is already an
   `observer`, but the panel is one big observer mapping `grouped`, so any run's
   change re-renders the whole list. Lean: observe per-row (rows read their own
   run), keep `grouped` cheap/memoized, and make sure a single event only repaints
   its row. Revisit alongside #6 (virtualization) and pin #3 (load). Verify with
   React DevTools "highlight updates".

10. **Accessibility audit (dedicated pass).**
    - **Live regions:** rows are `aria-live="polite"` — but per-step announcements
      could flood a screen reader on a chatty run. Scope live regions to
      status/approval changes, not every `step_*`; consider announcing a
      summarized "step N of M" rather than each label.
    - **Contrast (WCAG AA):** verify the label-color chips + `custom-text-*` tones,
      especially white text on the indigo Approve / emerald Resume buttons and the
      faint `text-custom-text-400` meta.
    - **Touch targets:** row buttons are small (`px-2.5 py-1`); bump to ≥44px on
      mobile / the full-screen variant.
    - **Keyboard nav:** focus order in the drawer, Esc-to-close, visible
      focus-visible on pip/buttons/steer input, and whether the drawer should trap
      focus while open.
    - **Reduced motion:** pulse is already `motion-safe`; audit any other motion.
      Ties to pin #4 (mobile full-screen variant is where big targets matter most).

11. **Multi-provider LLM support (low priority, long-term).** The runtime is
    Anthropic-only today (Tool Runner + Opus 4.8). Depending on one provider is
    neither reliable enough (outages) nor appropriate for all customers (budget,
    self-host/fine-tuning, trade/regulatory constraints, data-residency). Long
    term: abstract the runtime behind a provider-agnostic interface (the tools +
    the `@plane/agents` event contract already are provider-neutral — only
    `dispatch`/`toolRunner` is Anthropic-specific), so the model layer is
    swappable per deployment/customer. Not near-term; the contract seam already
    makes this a contained change later.
