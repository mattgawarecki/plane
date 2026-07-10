/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { statusPresentation } from "./status-presentation";

describe("statusPresentation", () => {
  it("maps blocked statuses to the attention tone", () => {
    expect(statusPresentation("awaiting_approval").tone).toBe("attention");
    expect(statusPresentation("waiting_for_input").tone).toBe("attention");
  });

  it("maps running to live and failed to fail", () => {
    expect(statusPresentation("running").tone).toBe("live");
    expect(statusPresentation("failed").tone).toBe("fail");
  });

  it("gives every status a non-empty human label", () => {
    for (const s of ["queued", "running", "paused", "succeeded", "cancelled"] as const) {
      expect(statusPresentation(s).label.length).toBeGreaterThan(0);
    }
  });
});
