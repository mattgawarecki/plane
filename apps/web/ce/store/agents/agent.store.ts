/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, computed, makeObservable, observable, runInAction } from "mobx";
import {
  applyEvent,
  emptyAgentState,
  reconcile,
  selectActiveCount,
  selectGroupedRuns,
  selectRunsForTarget,
} from "@plane/agents";
import type {
  IAgentService,
  TAgentCollectionState,
  TAgentCommand,
  TAgentEvent,
  TAgentRun,
  TAgentRunStatus,
  TAgentTarget,
} from "@plane/agents";
import { AgentService, type IAgentDispatchService } from "@/plane-web/services/agents/agent.service";

// Commands whose local effect is safe to show immediately (reversible / eventual).
// Approve/reject are deliberately NOT here — a gate resolution is server-authoritative,
// and an optimistic guess there could mislead about an irreversible action.
const OPTIMISTIC_ON_COMMAND: Partial<Record<TAgentCommand["type"], TAgentRunStatus>> = {
  pause: "paused",
  resume: "running",
  cancel: "cancelled",
};
const TERMINAL: ReadonlySet<TAgentRunStatus> = new Set<TAgentRunStatus>(["succeeded", "failed", "cancelled"]);

/**
 * Thin MobX adapter over the pure `@plane/agents` reducer. All state logic
 * lives in the reducer/selectors; this class only makes the projection
 * observable (single `state.ref`) and exposes async I/O. Keeping it thin is the
 * point — the tested, framework-free core can't be reintroduced with bugs here.
 */
export class AgentStore {
  state: TAgentCollectionState = emptyAgentState();
  /** Whether the dock panel is open. Lifted here so the header pip and the
   *  shell-mounted panel (different subtrees) share one source of truth. */
  panelOpen = false;
  /** Client-local dismissed set for the "Recently done" group. Not persisted —
   *  a projection-level "hide" (promote to a real command later if it must sync). */
  dismissedRunIds = new Set<string>();
  /** Optimistic status overrides applied on top of the server projection so the UI
   *  reflects an action instantly. Each entry is retired in `hydrate` once the
   *  server catches up (or moves to a terminal state), so the server stays the
   *  source of truth — this only hides round-trip latency, never overrides it. */
  optimisticStatus = new Map<string, TAgentRunStatus>();
  private service: IAgentDispatchService;

  constructor(
    private root: unknown,
    service?: IAgentDispatchService
  ) {
    this.service = service ?? new AgentService();
    makeObservable(this, {
      state: observable.ref, // whole projection swapped by ref — reducer returns fresh objects
      panelOpen: observable,
      dismissedRunIds: observable,
      optimisticStatus: observable,
      effectiveState: computed,
      grouped: computed,
      visibleGrouped: computed,
      activeCount: computed,
      ingestEvent: action,
      hydrate: action,
      setPanelOpen: action,
      togglePanel: action,
      dismissRun: action,
      dismissAllDone: action,
      setOptimisticStatus: action,
      clearOptimisticStatus: action,
    });
  }

  setPanelOpen(open: boolean) {
    this.panelOpen = open;
  }
  togglePanel() {
    this.panelOpen = !this.panelOpen;
  }

  setOptimisticStatus(runId: string, status: TAgentRunStatus) {
    this.optimisticStatus.set(runId, status);
  }
  clearOptimisticStatus(runId: string) {
    this.optimisticStatus.delete(runId);
  }

  /** Server projection with optimistic overrides patched in. Everything the UI
   *  reads (grouping, counts) flows through here, so an optimistic change lands
   *  everywhere at once. */
  get effectiveState(): TAgentCollectionState {
    if (this.optimisticStatus.size === 0) return this.state;
    const runs: TAgentCollectionState["runs"] = { ...this.state.runs };
    this.optimisticStatus.forEach((status, id) => {
      const run = runs[id];
      if (run) runs[id] = { ...run, status };
    });
    return { ...this.state, runs };
  }

  /** Grouped runs with the client-dismissed "done" rows hidden, and "done" sorted
   *  newest-first — so a just-finished run (e.g. a fresh Ask answer) sits at the top
   *  of "Recently done" instead of being appended out of view at the bottom. */
  get visibleGrouped() {
    const g = this.grouped;
    // filter() already returns a fresh array, so sorting it in place never mutates
    // state. (toSorted would need a newer lib target than this build.)
    const done = g.done.filter((r) => !this.dismissedRunIds.has(r.id));
    // eslint-disable-next-line unicorn/no-array-sort -- fresh array from filter(), state untouched
    done.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { ...g, done };
  }
  dismissRun(runId: string) {
    this.dismissedRunIds.add(runId);
  }
  dismissAllDone() {
    for (const run of this.grouped.done) this.dismissedRunIds.add(run.id);
  }

  get grouped() {
    return selectGroupedRuns(this.effectiveState);
  }
  get activeCount() {
    return selectActiveCount(this.effectiveState);
  }
  runsForTarget(target: Pick<TAgentTarget, "entityType" | "entityId">): TAgentRun[] {
    return selectRunsForTarget(this.effectiveState, target);
  }

  ingestEvent(event: TAgentEvent) {
    this.state = applyEvent(this.state, event);
  }
  hydrate(runs: TAgentRun[]) {
    this.state = reconcile(this.state, runs);
    // Retire optimistic overrides the server has caught up to (matched) or moved
    // past (any terminal state) — and any whose run vanished. Server wins.
    this.optimisticStatus.forEach((status, id) => {
      const srv = this.state.runs[id];
      if (!srv || srv.status === status || TERMINAL.has(srv.status)) this.optimisticStatus.delete(id);
    });
  }

  async loadRuns(params: Parameters<IAgentService["listRuns"]>[0]) {
    const { runs } = await this.service.listRuns(params);
    runInAction(() => this.hydrate(runs));
  }

  async runCommand(params: { workspaceId: string; command: TAgentCommand }) {
    // Optimistic: reflect reversible transitions locally at once, then let the
    // server projection reconcile via the poll. Roll back if the send fails.
    const optimistic = OPTIMISTIC_ON_COMMAND[params.command.type];
    if (optimistic) runInAction(() => this.setOptimisticStatus(params.command.runId, optimistic));
    try {
      await this.service.sendCommand(params);
    } catch (err) {
      if (optimistic) runInAction(() => this.clearOptimisticStatus(params.command.runId));
      throw err;
    }
  }

  /** Start a run from a free-text request. The new run surfaces via the panel's
   *  2500ms `loadRuns` poll — no optimistic insert (the bridge may return an
   *  empty runId until the run registers, so we cannot reliably seed on it). */
  async dispatch(request: string): Promise<{ runId: string }> {
    return this.service.dispatch(request);
  }
}
