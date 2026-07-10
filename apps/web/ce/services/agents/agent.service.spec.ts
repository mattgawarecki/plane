/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import { AgentService } from "./agent.service";

describe("AgentService", () => {
  it("POSTs a command to the run's command endpoint (runId stripped into the path)", async () => {
    const svc = new AgentService("http://x");
    const post = vi.spyOn(svc, "post").mockResolvedValue({ data: {} } as never);
    await svc.sendCommand({ workspaceId: "w1", command: { runId: "r1", type: "cancel", payload: {} } });
    expect(post).toHaveBeenCalledWith("/api/workspaces/w1/agent-runs/r1/commands/", { type: "cancel", payload: {} });
  });

  it("GETs the run list for a workspace", async () => {
    const svc = new AgentService("http://x");
    const get = vi.spyOn(svc, "get").mockResolvedValue({ data: { runs: [], nextCursor: undefined } } as never);
    const res = await svc.listRuns({ workspaceId: "w1" });
    expect(get).toHaveBeenCalledWith("/api/workspaces/w1/agent-runs/", { params: {} });
    expect(res.runs).toEqual([]);
  });
});
