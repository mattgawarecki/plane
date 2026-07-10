/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { shouldSubscribe } from "./subscription-policy";

describe("shouldSubscribe", () => {
  it("is false when disabled", () => {
    expect(shouldSubscribe({ enabled: false, hasWatchTargets: true })).toBe(false);
  });
  it("is false when nothing to watch", () => {
    expect(shouldSubscribe({ enabled: true, hasWatchTargets: false })).toBe(false);
  });
  it("is true only when enabled and watching", () => {
    expect(shouldSubscribe({ enabled: true, hasWatchTargets: true })).toBe(true);
  });
});
