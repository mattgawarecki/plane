/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { selectGroupedRuns, selectActiveCount, selectRunsForTarget } from "../src/state/selectors";
import type { TAgentRun } from "../src/types/session";

const run = (id: string, status: TAgentRun["status"], over: Partial<TAgentRun> = {}): TAgentRun => ({
  id,
  agentKey: "k",
  title: id,
  status,
  workspaceId: "w1",
  initiatedBy: "u1",
  createdAt: "t",
  updatedAt: "t",
  ...over,
});

const state = (runs: TAgentRun[]) => ({
  runs: Object.fromEntries(runs.map((r) => [r.id, r])),
  lastSequence: {},
});

describe("selectors", () => {
  it("groups by priority: blocked, running (incl. paused), queued, done", () => {
    const g = selectGroupedRuns(
      state([
        run("a", "running"),
        run("b", "awaiting_approval"),
        run("c", "queued"),
        run("d", "succeeded"),
        run("e", "waiting_for_input"),
        run("f", "paused"),
      ])
    );
    expect(g.blocked.map((r) => r.id).toSorted()).toEqual(["b", "e"]);
    expect(g.running.map((r) => r.id).toSorted()).toEqual(["a", "f"]);
    expect(g.queued.map((r) => r.id)).toEqual(["c"]);
    expect(g.done.map((r) => r.id)).toEqual(["d"]);
  });

  it("counts active runs (excludes terminal)", () => {
    expect(selectActiveCount(state([run("a", "running"), run("d", "cancelled")]))).toBe(1);
  });

  it("filters runs by target", () => {
    const rs = selectRunsForTarget(
      state([run("a", "running", { target: { entityType: "work_item", entityId: "PLAT-1" } }), run("b", "running")]),
      { entityType: "work_item", entityId: "PLAT-1" }
    );
    expect(rs.map((r) => r.id)).toEqual(["a"]);
  });
});
