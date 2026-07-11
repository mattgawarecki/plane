/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";
import { useAgentSubscription } from "@/plane-web/hooks/agents/use-agent-subscription";
import { AgentStatusChip } from "./agent-status-chip";

/**
 * The hybrid reach: a compact chip on a work item when ≥1 agent run targets it.
 * Subscribes only while there's a live run to watch. Clicking opens the panel
 * focused on the run.
 */
export const AgentInlineIndicator = observer(
  ({
    workspaceId,
    entityType,
    entityId,
    onOpen,
  }: {
    workspaceId: string;
    entityType: string;
    entityId: string;
    onOpen: (runId: string) => void;
  }) => {
    const store = useAgentStore();
    const runs = store.runsForTarget({ entityType, entityId });
    useAgentSubscription({ enabled: runs.length > 0, workspaceId, runIds: runs.map((r) => r.id) });

    if (!runs.length) return null;
    const primary = runs[0];
    return (
      <button className="inline-flex items-center gap-1.5 text-11" onClick={() => onOpen(primary.id)}>
        <span className="text-tertiary">🤖</span>
        <AgentStatusChip status={primary.status} />
        {runs.length > 1 && <span className="text-placeholder">+{runs.length - 1}</span>}
      </button>
    );
  }
);
