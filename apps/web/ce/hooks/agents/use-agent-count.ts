/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
import { AgentService } from "@/plane-web/services/agents/agent.service";

const service = new AgentService();

/**
 * The ambient header count. A cheap poll (revalidate-on-focus, ~45s), NOT a live
 * socket — the socket is reserved for actively watching the panel. Returns 0 when
 * disabled so callers render nothing.
 */
export const useAgentCount = (p: { enabled: boolean; workspaceId: string }) => {
  const { data } = useSWR(
    p.enabled ? ["agent-count", p.workspaceId] : null,
    async () => {
      const { runs } = await service.listRuns({
        workspaceId: p.workspaceId,
        statuses: ["queued", "running", "waiting_for_input", "awaiting_approval"],
      });
      return runs.length;
    },
    { refreshInterval: 45000, revalidateOnFocus: true }
  );
  return p.enabled ? (data ?? 0) : 0;
};
