/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { IAgentService, TAgentCommand, TAgentRun } from "@plane/agents";
import { APIService } from "@/services/api.service";

// Agent runs come from the runtime bridge (demo) or a real backend later — set
// VITE_AGENTS_API_BASE to override. Defaults to the local bridge for the demo.
const AGENTS_API_BASE = import.meta.env.VITE_AGENTS_API_BASE || API_BASE_URL || "http://localhost:4000";

/**
 * REST adapter for agent runs. The event *stream* arrives via the transport;
 * this is the request/response half (initial load, history, commands).
 * Endpoints are provisional — the source can be a real backend or the demo
 * runtime's HTTP surface; the store doesn't care which.
 */
export class AgentService extends APIService implements IAgentService {
  constructor(baseURL: string = AGENTS_API_BASE) {
    super(baseURL);
  }

  async listRuns(params: {
    workspaceId: string;
    target?: { entityType: string; entityId: string };
    statuses?: TAgentRun["status"][];
    cursor?: string;
  }): Promise<{ runs: TAgentRun[]; nextCursor?: string }> {
    const { workspaceId, ...query } = params;
    const res = await this.get(`/api/workspaces/${workspaceId}/agent-runs/`, { params: query });
    return res.data;
  }

  async getRun(params: { workspaceId: string; runId: string }): Promise<TAgentRun> {
    const res = await this.get(`/api/workspaces/${params.workspaceId}/agent-runs/${params.runId}/`);
    return res.data;
  }

  async sendCommand(params: { workspaceId: string; command: TAgentCommand }): Promise<void> {
    const { runId, ...body } = params.command;
    await this.post(`/api/workspaces/${params.workspaceId}/agent-runs/${runId}/commands/`, body);
  }
}
