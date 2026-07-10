/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { AGENT_BLOCKED_STATUSES, AGENT_TERMINAL_STATUSES } from "../types/session";
import type { TAgentRun, TAgentTarget } from "../types/session";
import type { TAgentCollectionState } from "./types";

const all = (state: TAgentCollectionState): TAgentRun[] => Object.values(state.runs);

export const selectGroupedRuns = (state: TAgentCollectionState) => {
  const groups = {
    blocked: [] as TAgentRun[],
    running: [] as TAgentRun[],
    queued: [] as TAgentRun[],
    done: [] as TAgentRun[],
  };
  for (const run of all(state)) {
    if (AGENT_BLOCKED_STATUSES.includes(run.status)) groups.blocked.push(run);
    else if (run.status === "running" || run.status === "paused") groups.running.push(run);
    else if (run.status === "queued") groups.queued.push(run);
    else if (AGENT_TERMINAL_STATUSES.includes(run.status)) groups.done.push(run);
  }
  return groups;
};

export const selectActiveCount = (state: TAgentCollectionState): number =>
  all(state).filter((r) => !AGENT_TERMINAL_STATUSES.includes(r.status)).length;

export const selectRunsForTarget = (
  state: TAgentCollectionState,
  target: Pick<TAgentTarget, "entityType" | "entityId">
): TAgentRun[] =>
  all(state).filter((r) => r.target?.entityType === target.entityType && r.target?.entityId === target.entityId);
