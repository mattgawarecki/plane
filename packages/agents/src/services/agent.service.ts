/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAgentCommand } from "../types/commands";
import type { TAgentRun } from "../types/session";

/**
 * PROVISIONAL CONTRACT.
 *
 * Request/response surface for agent runs (the non-real-time half; live updates
 * arrive via the transport seam). Concrete implementations live in the app
 * layer; tests mock this interface directly.
 */
export interface IAgentService {
  /** List runs visible to the caller, newest first. */
  listRuns(params: {
    workspaceId: string;
    /** Narrow to a specific entity (e.g. a work item's runs). */
    target?: { entityType: string; entityId: string };
    /** Omit to include all; pass to filter (e.g. only active). */
    statuses?: TAgentRun["status"][];
    cursor?: string;
  }): Promise<{ runs: TAgentRun[]; nextCursor?: string }>;

  /** Fetch a single run with its step history. */
  getRun(params: { workspaceId: string; runId: string }): Promise<TAgentRun>;

  /** Send a control command (interrupt/steer/answer/approve/retry). */
  sendCommand(params: { workspaceId: string; command: TAgentCommand }): Promise<void>;
}
