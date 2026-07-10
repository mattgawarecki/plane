/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAgentEvent } from "../types/events";
import type { TAgentRun, TAgentStep } from "../types/session";
import type { TAgentCollectionState } from "./types";

/** Merge a step into a run by id, appending if new. */
const upsertStep = (steps: TAgentStep[] | undefined, step: TAgentStep): TAgentStep[] => {
  const list = steps ? [...steps] : [];
  const i = list.findIndex((s) => s.id === step.id);
  if (i === -1) list.push(step);
  else list[i] = { ...list[i], ...step };
  return list;
};

/** Apply one event to one run, producing an updated run. */
const reduceRun = (run: TAgentRun, event: TAgentEvent): TAgentRun => {
  switch (event.type) {
    case "status_changed":
      return { ...run, status: event.payload.status };
    case "progress":
      return { ...run, progress: { ...run.progress, ...event.payload } };
    case "step_started":
    case "step_updated":
    case "step_completed":
      return { ...run, steps: upsertStep(run.steps, event.payload) };
    case "completed": {
      const result = event.payload.result ?? run.result;
      return result === undefined
        ? { ...run, status: event.payload.status }
        : { ...run, status: event.payload.status, result };
    }
    case "error":
      return { ...run, status: "failed", error: event.payload };
    default:
      return run; // total: unknown types are ignored
  }
};

/**
 * Pure. Apply one event to the collection state.
 * Ignores events for unknown runs and stale/duplicate sequences.
 */
export const applyEvent = (state: TAgentCollectionState, event: TAgentEvent): TAgentCollectionState => {
  const run = state.runs[event.runId];
  if (!run) return state;
  const last = state.lastSequence[event.runId] ?? -Infinity;
  if (event.sequence <= last) return state;

  return {
    runs: { ...state.runs, [event.runId]: reduceRun(run, event) },
    lastSequence: { ...state.lastSequence, [event.runId]: event.sequence },
  };
};

/**
 * Pure. Merge an authoritative snapshot into state, keyed by run id.
 * Runs absent from the snapshot are preserved (scope is the caller's choice).
 * lastSequence resets to -1 so the next streamed event applies cleanly.
 */
export const reconcile = (state: TAgentCollectionState, snapshot: TAgentRun[]): TAgentCollectionState => {
  const runs = { ...state.runs };
  const lastSequence = { ...state.lastSequence };
  for (const run of snapshot) {
    runs[run.id] = run;
    lastSequence[run.id] = -1;
  }
  return { runs, lastSequence };
};
