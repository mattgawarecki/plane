/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import type { TAgentRun } from "@plane/agents";
import { AgentStore } from "./agent.store";

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

describe("AgentStore", () => {
  it("hydrates from a snapshot and exposes grouped runs + active count", () => {
    const store = new AgentStore({}, { listRuns: vi.fn(), getRun: vi.fn(), sendCommand: vi.fn() });
    store.hydrate([run("a", "running"), run("b", "awaiting_approval")]);
    expect(store.grouped.running.map((r) => r.id)).toEqual(["a"]);
    expect(store.grouped.blocked.map((r) => r.id)).toEqual(["b"]);
    expect(store.activeCount).toBe(2);
  });

  it("ingests an event through the reducer", () => {
    const store = new AgentStore({}, { listRuns: vi.fn(), getRun: vi.fn(), sendCommand: vi.fn() });
    store.hydrate([run("a", "running")]);
    store.ingestEvent({
      runId: "a",
      sequence: 1,
      timestamp: "t",
      type: "status_changed",
      payload: { status: "succeeded" },
    });
    expect(store.grouped.done.map((r) => r.id)).toEqual(["a"]);
  });

  it("loadRuns delegates to the service and hydrates", async () => {
    const service = {
      listRuns: vi.fn().mockResolvedValue({ runs: [run("a")] }),
      getRun: vi.fn(),
      sendCommand: vi.fn(),
    };
    const store = new AgentStore({}, service);
    await store.loadRuns({ workspaceId: "w1" });
    expect(service.listRuns).toHaveBeenCalledWith({ workspaceId: "w1" });
    expect(store.grouped.running.map((r) => r.id)).toEqual(["a"]);
  });

  it("runCommand delegates to the service without optimistic mutation", async () => {
    const service = { listRuns: vi.fn(), getRun: vi.fn(), sendCommand: vi.fn().mockResolvedValue(undefined) };
    const store = new AgentStore({}, service);
    store.hydrate([run("a", "running")]);
    await store.runCommand({ workspaceId: "w1", command: { runId: "a", type: "cancel", payload: {} } });
    expect(service.sendCommand).toHaveBeenCalled();
    expect(store.grouped.running.map((r) => r.id)).toEqual(["a"]); // unchanged until an event arrives
  });
});
