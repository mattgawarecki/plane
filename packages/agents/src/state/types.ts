/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAgentRun } from "../types/session";

/** Client-side projection of server-owned run state. Never authoritative. */
export type TAgentCollectionState = {
  /** Runs by id. */
  runs: Record<string, TAgentRun>;
  /** Highest applied event `sequence` per run id (gap detection). */
  lastSequence: Record<string, number>;
};

export const emptyAgentState = (): TAgentCollectionState => ({
  runs: {},
  lastSequence: {},
});
