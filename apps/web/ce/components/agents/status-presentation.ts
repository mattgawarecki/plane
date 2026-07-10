/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAgentRunStatus } from "@plane/agents";

/** Semantic tone — UI-agnostic so the mapping stays testable without colors. */
export type TAgentTone = "live" | "attention" | "success" | "fail" | "queued";

const MAP: Record<TAgentRunStatus, { label: string; tone: TAgentTone }> = {
  queued: { label: "Queued", tone: "queued" },
  running: { label: "Running", tone: "live" },
  paused: { label: "Paused", tone: "queued" },
  // both blocked states read "Needs you" — the human is the blocker
  waiting_for_input: { label: "Needs you", tone: "attention" },
  awaiting_approval: { label: "Needs you", tone: "attention" },
  succeeded: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "fail" },
  cancelled: { label: "Cancelled", tone: "queued" },
};

export const statusPresentation = (status: TAgentRunStatus): { label: string; tone: TAgentTone } =>
  MAP[status] ?? { label: "Unknown", tone: "queued" };
