/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAgentError, TAgentProgress, TAgentResult, TAgentRunStatus, TAgentStep } from "./session";

/**
 * PROVISIONAL CONTRACT.
 *
 * Real-time envelope the runtime pushes to the client (over whatever transport
 * is chosen — poll/SSE/WS; see the transport seam). Events are ordered per run
 * by `sequence` so a client can detect gaps and reconcile after reconnect.
 */

export type TAgentEventType =
  | "status_changed"
  | "progress"
  | "step_started"
  | "step_updated"
  | "step_completed"
  | "input_requested"
  | "approval_requested"
  | "completed"
  | "error";

type TAgentEventBase<T extends TAgentEventType, P> = {
  /** Which run this event belongs to. */
  runId: string;
  /** Monotonic per-run sequence number for ordering + gap detection. */
  sequence: number;
  timestamp: string;
  type: T;
  payload: P;
};

export type TAgentInputRequest = {
  promptId: string;
  /** Question posed to the user. */
  prompt: string;
};

export type TAgentApprovalRequest = {
  approvalId: string;
  /** What the agent proposes to do and wants approved. */
  summary: string;
  /** Hint that the action is hard to undo, so the UI can weight it. */
  irreversible?: boolean;
};

export type TAgentEvent =
  | TAgentEventBase<"status_changed", { status: TAgentRunStatus }>
  | TAgentEventBase<"progress", TAgentProgress>
  | TAgentEventBase<"step_started", TAgentStep>
  | TAgentEventBase<"step_updated", TAgentStep>
  | TAgentEventBase<"step_completed", TAgentStep>
  | TAgentEventBase<"input_requested", TAgentInputRequest>
  | TAgentEventBase<"approval_requested", TAgentApprovalRequest>
  | TAgentEventBase<"completed", { status: TAgentRunStatus; result?: TAgentResult }>
  | TAgentEventBase<"error", TAgentError>;
