/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

const base = { PLANE_API_KEY: "tok_123" };

describe("loadConfig", () => {
  it("applies defaults and reads the token from PLANE_API_KEY", () => {
    const c = loadConfig({ ...base });
    expect(c.base).toBe("http://localhost:8000");
    expect(c.workspace).toBe("klarity");
    expect(c.token).toBe("tok_123");
    expect(c.projectId).toBeUndefined();
  });

  it("falls back to PLANE_API_TOKEN for the token", () => {
    expect(loadConfig({ PLANE_API_TOKEN: "tok_456" }).token).toBe("tok_456");
  });

  it("reads overrides (base, workspace, project, anthropic key)", () => {
    const c = loadConfig({
      ...base,
      PLANE_API_BASE: "http://127.0.0.1:8000",
      PLANE_WORKSPACE: "acme",
      PLANE_PROJECT_ID: "proj_1",
      ANTHROPIC_API_KEY: "sk-ant-xyz",
    });
    expect(c.base).toBe("http://127.0.0.1:8000");
    expect(c.workspace).toBe("acme");
    expect(c.projectId).toBe("proj_1");
    expect(c.anthropicKey).toBe("sk-ant-xyz");
  });

  it("throws a helpful error when the token is missing", () => {
    expect(() => loadConfig({})).toThrow(/API token|API key/i);
  });

  it("throws (via the guardrail) when the base is non-local", () => {
    expect(() => loadConfig({ ...base, PLANE_API_BASE: "https://app.plane.so" })).toThrow(/local/i);
  });
});
