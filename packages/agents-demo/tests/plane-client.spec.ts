/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import { PlaneClient, type TFetch } from "../src/client/plane-client";

const ok = (data: unknown, status = 200): Response =>
  ({ ok: status < 400, status, json: async () => data, text: async () => "" }) as Response;

describe("PlaneClient", () => {
  it("prefixes /api/v1 and sends the X-Api-Key header", async () => {
    const fetchImpl = vi.fn<TFetch>().mockResolvedValue(ok({ ping: true }));
    const c = new PlaneClient({ base: "http://localhost:8000", token: "tok", fetchImpl });
    const res = await c.get<{ ping: boolean }>("/workspaces/klarity/projects/");
    expect(res.ping).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://localhost:8000/api/v1/workspaces/klarity/projects/");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("tok");
  });

  it("serializes the body on POST", async () => {
    const fetchImpl = vi.fn<TFetch>().mockResolvedValue(ok({ id: "wi_1" }));
    const c = new PlaneClient({ base: "http://localhost:8000", token: "tok", fetchImpl });
    await c.post("/x/", { name: "A" });
    expect(fetchImpl.mock.calls[0]![1].body).toBe(JSON.stringify({ name: "A" }));
  });

  it("throws on a non-ok response with the status", async () => {
    const fetchImpl = vi.fn<TFetch>().mockResolvedValue(ok({}, 400));
    const c = new PlaneClient({ base: "http://localhost:8000", token: "tok", fetchImpl });
    await expect(c.get("/bad/")).rejects.toThrow(/400/);
  });

  it("no-ops writes under dry-run and returns a synthetic id (no fetch)", async () => {
    const fetchImpl = vi.fn<TFetch>();
    const c = new PlaneClient({ base: "http://localhost:8000", token: "tok", dryRun: true, fetchImpl, log: () => {} });
    const res = await c.post<{ id: string }>("/x/", { name: "A" });
    expect(res.id).toMatch(/^dry_/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still reads (GET) under dry-run", async () => {
    const fetchImpl = vi.fn<TFetch>().mockResolvedValue(ok([{ id: "s1" }]));
    const c = new PlaneClient({ base: "http://localhost:8000", token: "tok", dryRun: true, fetchImpl });
    await c.get("/states/");
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("refuses a non-local base on every request", async () => {
    const c = new PlaneClient({ base: "https://app.plane.so", token: "tok", fetchImpl: vi.fn<TFetch>() });
    await expect(c.get("/x/")).rejects.toThrow(/local/i);
  });
});
