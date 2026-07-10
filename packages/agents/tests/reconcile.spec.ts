/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { emptyAgentState } from "../src/state/types";
import { reconcile } from "../src/state/reducer";
import type { TAgentRun } from "../src/types/session";

const run = (id: string, status: TAgentRun["status"] = "running"): TAgentRun => ({
  id,
  agentKey: "k",
  title: id,
  status,
  workspaceId: "w1",
  initiatedBy: "u1",
  createdAt: "t",
  updatedAt: "t",
});

describe("reconcile", () => {
  it("loads snapshot runs by id", () => {
    const next = reconcile(emptyAgentState(), [run("a"), run("b")]);
    expect(Object.keys(next.runs).toSorted()).toEqual(["a", "b"]);
    expect(next.lastSequence.a).toBe(-1);
  });

  it("replaces an existing run with the authoritative snapshot version", () => {
    const start = { runs: { a: run("a", "running") }, lastSequence: { a: 9 } };
    const next = reconcile(start, [run("a", "succeeded")]);
    expect(next.runs.a.status).toBe("succeeded");
    expect(next.lastSequence.a).toBe(-1);
  });

  it("preserves runs not present in the snapshot", () => {
    const start = { runs: { a: run("a") }, lastSequence: { a: 3 } };
    const next = reconcile(start, [run("b")]);
    expect(next.runs.a).toBeDefined();
    expect(next.lastSequence.a).toBe(3);
  });
});
