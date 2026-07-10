/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * PROVISIONAL CONTRACT.
 *
 * User -> agent control messages. This is the "behavior contract": how a user
 * interrupts, steers, or answers a running agent. The runtime is responsible
 * for honoring these; the UI only emits them.
 */

export type TAgentCommandType =
  /** Terminally stop the run and discard in-progress work. */
  | "cancel"
  /** Suspend the run so it can be resumed later. */
  | "pause"
  /** Resume a paused run. */
  | "resume"
  /** Inject new guidance WITHOUT killing the run (steering). */
  | "correct"
  /** Answer a `waiting_for_input` prompt. */
  | "provide_input"
  /** Approve an `awaiting_approval` gate. */
  | "approve"
  /** Reject an `awaiting_approval` gate. */
  | "reject"
  /** Re-run a failed run, optionally from its last checkpoint. */
  | "retry";

type TAgentCommandBase<T extends TAgentCommandType, P> = {
  runId: string;
  type: T;
  payload: P;
};

export type TAgentCommand =
  | TAgentCommandBase<"cancel", { reason?: string }>
  | TAgentCommandBase<"pause", Record<string, never>>
  | TAgentCommandBase<"resume", Record<string, never>>
  | TAgentCommandBase<"correct", { guidance: string }>
  | TAgentCommandBase<"provide_input", { promptId: string; response: string }>
  | TAgentCommandBase<"approve", { approvalId: string; note?: string }>
  | TAgentCommandBase<"reject", { approvalId: string; note?: string }>
  | TAgentCommandBase<"retry", { fromCheckpoint?: boolean }>;
