/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { emptyAgentState } from "../src/state/types";
import { applyEvent } from "../src/state/reducer";
import type { TAgentEvent } from "../src/types/events";
import type { TAgentRun } from "../src/types/session";

const baseRun = (over: Partial<TAgentRun> = {}): TAgentRun => ({
  id: "r1",
  agentKey: "triage",
  title: "Triage",
  status: "running",
  workspaceId: "w1",
  initiatedBy: "u1",
  createdAt: "t0",
  updatedAt: "t0",
  ...over,
});

const stateWith = (run: TAgentRun, seq = 0) => ({
  runs: { [run.id]: run },
  lastSequence: { [run.id]: seq },
});

const evt = (over: Partial<TAgentEvent> = {}): TAgentEvent =>
  ({
    runId: "r1",
    sequence: 1,
    timestamp: "t1",
    type: "status_changed",
    payload: { status: "succeeded" },
    ...over,
  }) as TAgentEvent;

describe("applyEvent", () => {
  it("applies a status change when sequence advances", () => {
    const next = applyEvent(stateWith(baseRun()), evt());
    expect(next.runs.r1.status).toBe("succeeded");
    expect(next.lastSequence.r1).toBe(1);
  });

  it("ignores a stale or duplicate sequence", () => {
    const next = applyEvent(stateWith(baseRun(), 5), evt({ sequence: 5 }));
    expect(next.runs.r1.status).toBe("running");
    expect(next.lastSequence.r1).toBe(5);
  });

  it("ignores events for an unknown run", () => {
    const next = applyEvent(emptyAgentState(), evt());
    expect(next.runs.r1).toBeUndefined();
  });

  it("ignores an unknown event type without throwing", () => {
    const next = applyEvent(stateWith(baseRun()), evt({ type: "bogus" as TAgentEvent["type"], payload: {} as never }));
    expect(next.runs.r1.status).toBe("running");
    expect(next.lastSequence.r1).toBe(1);
  });

  it("appends a step on step_started", () => {
    const e = evt({ type: "step_started", payload: { id: "s1", label: "label", status: "running" } });
    const next = applyEvent(stateWith(baseRun()), e);
    expect(next.runs.r1.steps).toEqual([{ id: "s1", label: "label", status: "running" }]);
  });

  it("merges progress", () => {
    const e = evt({ type: "progress", payload: { percent: 40, currentStep: 2, totalSteps: 5 } });
    const next = applyEvent(stateWith(baseRun()), e);
    expect(next.runs.r1.progress).toEqual({ percent: 40, currentStep: 2, totalSteps: 5 });
  });

  it("sets result + status on completed", () => {
    const e = evt({ type: "completed", payload: { status: "succeeded", result: { summary: "done" } } });
    const next = applyEvent(stateWith(baseRun()), e);
    expect(next.runs.r1.status).toBe("succeeded");
    expect(next.runs.r1.result).toEqual({ summary: "done" });
  });
});
