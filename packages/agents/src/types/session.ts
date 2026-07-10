/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * PROVISIONAL CONTRACT.
 *
 * These shapes are the seam between the (separately built) agent runtime and
 * Plane's UI. They are intentionally transport-agnostic. Field names and the
 * status set are expected to be finalized during design; anything consuming
 * them should treat unknown status values defensively.
 */

/**
 * Lifecycle state of a single agent run.
 *
 * - `queued`            accepted, not yet started
 * - `running`           actively working
 * - `paused`            suspended by the user, resumable
 * - `waiting_for_input` blocked; needs the user to answer a question
 * - `awaiting_approval` blocked; needs the user to approve a proposed action
 * - `succeeded`         finished, terminal
 * - `failed`            errored, terminal
 * - `cancelled`         interrupted by the user, terminal
 */
export type TAgentRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "waiting_for_input"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

/** Terminal states — no further updates expected after these. */
export const AGENT_TERMINAL_STATUSES: readonly TAgentRunStatus[] = ["succeeded", "failed", "cancelled"] as const;

/** States where the agent is blocked on the user before it can proceed. */
export const AGENT_BLOCKED_STATUSES: readonly TAgentRunStatus[] = ["waiting_for_input", "awaiting_approval"] as const;

/** What a run is acting on, so the UI can deep-link back to the entity. */
export type TAgentTarget = {
  /** e.g. "work_item", "page", "cycle", "project", "workspace" */
  entityType: string;
  entityId: string;
  /** Optional human label for display without a second fetch. */
  entityName?: string;
};

/** A single step in the run's timeline (the progress log). */
export type TAgentStep = {
  id: string;
  label: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  startedAt?: string;
  endedAt?: string;
  /** Optional short human-readable detail; NOT a full raw log dump. */
  detail?: string;
};

/** Coarse progress hint. All fields optional — agents may not know totals. */
export type TAgentProgress = {
  /** 0–100, if the agent can estimate it. */
  percent?: number;
  currentStep?: number;
  totalSteps?: number;
};

export type TAgentError = {
  code?: string;
  message: string;
  /** Whether the runtime considers this recoverable via retry/resume. */
  recoverable?: boolean;
};

/** Terminal summary shown after completion. */
export type TAgentResult = {
  /** One-line outcome for list rows. */
  summary?: string;
  /** Optional link the user can open to review changes/output. */
  reviewUrl?: string;
};

/**
 * A single spun-off agentic task (one "run").
 * This is the primary object the visibility UI renders.
 */
export type TAgentRun = {
  id: string;
  /** Stable identifier of the agent kind, e.g. "triage", "summarize". */
  agentKey: string;
  /** Human title for the run, e.g. "Triage new work items". */
  title: string;
  status: TAgentRunStatus;

  workspaceId: string;
  projectId?: string;
  target?: TAgentTarget;

  /** User who initiated the run. */
  initiatedBy: string;

  progress?: TAgentProgress;
  /** Most recent steps; full history may be paged separately. */
  steps?: TAgentStep[];

  result?: TAgentResult;
  error?: TAgentError;

  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};
