/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { assertLocalhost } from "../src/guardrail";

describe("assertLocalhost", () => {
  it("allows localhost and loopback hosts", () => {
    for (const base of [
      "http://localhost:8000",
      "http://127.0.0.1:8000",
      "http://[::1]:8000",
      "http://0.0.0.0:8000",
      "http://localhost", // no port
    ]) {
      expect(() => assertLocalhost(base)).not.toThrow();
    }
  });

  it("rejects any non-local host", () => {
    for (const base of [
      "https://app.plane.so",
      "http://192.168.1.5:8000", // LAN
      "http://10.0.0.2",
      "https://my-tunnel.ngrok.io",
      "http://localhost.evil.com", // suffix trick
    ]) {
      expect(() => assertLocalhost(base)).toThrow(/local/i);
    }
  });

  it("rejects an unparseable base", () => {
    expect(() => assertLocalhost("not a url")).toThrow();
  });
});
