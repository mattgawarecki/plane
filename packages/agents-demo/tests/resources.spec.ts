/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import { PlaneResources } from "../src/client/resources";
import type { PlaneClient } from "../src/client/plane-client";

/** A PlaneClient stub that records calls. */
const stub = () => {
  const get = vi.fn().mockResolvedValue([]);
  const post = vi.fn().mockResolvedValue({ id: "new_1" });
  const patch = vi.fn().mockResolvedValue({ id: "wi_1" });
  return { client: { get, post, patch } as unknown as PlaneClient, get, post, patch };
};

describe("PlaneResources", () => {
  it("searches work items at the workspace scope with an encoded query", async () => {
    const s = stub();
    await new PlaneResources(s.client, "klarity").searchWorkItems("billing close");
    expect(s.get).toHaveBeenCalledWith("/workspaces/klarity/work-items/search/?search=billing%20close");
  });

  it("creates a work item under the project", async () => {
    const s = stub();
    await new PlaneResources(s.client, "klarity", "proj_1").createWorkItem({ name: "Reconcile" });
    expect(s.post).toHaveBeenCalledWith("/workspaces/klarity/projects/proj_1/work-items/", { name: "Reconcile" });
  });

  it("creates a sub-issue by setting parent (no separate endpoint)", async () => {
    const s = stub();
    await new PlaneResources(s.client, "klarity", "proj_1").createSubIssue("parent_1", { name: "Chase invoices" });
    expect(s.post).toHaveBeenCalledWith("/workspaces/klarity/projects/proj_1/work-items/", {
      name: "Chase invoices",
      parent: "parent_1",
    });
  });

  it("resolves a state by group", async () => {
    const s = stub();
    s.get.mockResolvedValueOnce([
      { id: "s_backlog", name: "Backlog", group: "backlog" },
      { id: "s_cancel", name: "Cancelled", group: "cancelled" },
    ]);
    const state = await new PlaneResources(s.client, "klarity", "proj_1").resolveStateByGroup("cancelled");
    expect(state?.id).toBe("s_cancel");
  });

  it("throws when a project-scoped write has no projectId", async () => {
    const s = stub();
    await expect(new PlaneResources(s.client, "klarity").createWorkItem({ name: "x" })).rejects.toThrow(
      /PLANE_PROJECT_ID/
    );
  });
});
