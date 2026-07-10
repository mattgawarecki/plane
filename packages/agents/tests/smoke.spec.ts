/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { emptyAgentState } from "../src/state/types";

describe("emptyAgentState", () => {
  it("starts with no runs and no sequences", () => {
    const s = emptyAgentState();
    expect(s.runs).toEqual({});
    expect(s.lastSequence).toEqual({});
  });
});
