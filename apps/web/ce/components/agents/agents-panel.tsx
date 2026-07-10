/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import type { TAgentCommand } from "@plane/agents";
import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";
import { useAgentSubscription } from "@/plane-web/hooks/agents/use-agent-subscription";
import { useDeferredCancel } from "@/plane-web/hooks/agents/use-deferred-cancel";
import { AgentRunRow } from "./agent-run-row";

// Priority order — the blocking "Needs you" group is pinned to the top.
const GROUPS = [
  { key: "blocked", label: "Needs you" },
  { key: "running", label: "Running" },
  { key: "queued", label: "Queued" },
  { key: "done", label: "Recently done" },
] as const;

export const AgentsPanel = observer(({ workspaceId }: { workspaceId: string }) => {
  const store = useAgentStore();

  // Snapshot on mount (also the recovery path); subscribe live while open.
  useEffect(() => {
    void store.loadRuns({ workspaceId });
  }, [store, workspaceId]);
  useAgentSubscription({ enabled: true, workspaceId });

  const { pending, requestCancel, undoCancel } = useDeferredCancel(workspaceId);
  const grouped = store.grouped;
  const onCommand = (command: TAgentCommand) => void store.runCommand({ workspaceId, command });
  const empty = GROUPS.every((g) => grouped[g.key].length === 0);

  return (
    <div className="h-full overflow-auto">
      {empty && <div className="text-sm text-custom-text-300 p-6">No agent activity yet.</div>}
      {GROUPS.map((g) =>
        grouped[g.key].length ? (
          <div key={g.key}>
            <div className="text-custom-text-400 px-4 pt-3 pb-1 text-[11px] tracking-wide uppercase">{g.label}</div>
            {grouped[g.key].map((run) => (
              <AgentRunRow
                key={run.id}
                run={run}
                onCommand={onCommand}
                onRequestCancel={requestCancel}
                onUndoCancel={undoCancel}
                pendingCancel={pending.has(run.id)}
              />
            ))}
          </div>
        ) : null
      )}
    </div>
  );
});
