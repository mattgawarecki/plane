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
  TAgentTarget,
} from "@plane/agents";
import { AgentService } from "@/plane-web/services/agents/agent.service";

/**
 * Thin MobX adapter over the pure `@plane/agents` reducer. All state logic
 * lives in the reducer/selectors; this class only makes the projection
 * observable (single `state.ref`) and exposes async I/O. Keeping it thin is the
 * point — the tested, framework-free core can't be reintroduced with bugs here.
 */
export class AgentStore {
  state: TAgentCollectionState = emptyAgentState();
  private service: IAgentService;

  constructor(
    private root: unknown,
    service?: IAgentService
  ) {
    this.service = service ?? new AgentService();
    makeObservable(this, {
      state: observable.ref, // whole projection swapped by ref — reducer returns fresh objects
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
    // No optimistic terminal transition — reflect state only when the backend echoes an event.
    await this.service.sendCommand(params);
  }
}
