/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { backoffDelay } from "../src/state/backoff";

describe("backoffDelay", () => {
  it("grows exponentially from base", () => {
    expect(backoffDelay(0, { base: 500, cap: 30000 })).toBe(500);
    expect(backoffDelay(1, { base: 500, cap: 30000 })).toBe(1000);
    expect(backoffDelay(3, { base: 500, cap: 30000 })).toBe(4000);
  });

  it("caps the delay", () => {
    expect(backoffDelay(20, { base: 500, cap: 30000 })).toBe(30000);
  });

  it("treats negative attempts as zero", () => {
    expect(backoffDelay(-3, { base: 500, cap: 30000 })).toBe(500);
  });
});
