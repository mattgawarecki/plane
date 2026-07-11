/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect } from "react";
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

// `observer` so a store projection ref-swap (new `store.visibleGrouped`) re-renders the list.
export const AgentsPanel = observer(({ workspaceId }: { workspaceId: string }) => {
  const store = useAgentStore();

  // Demo wiring: poll the snapshot (also the recovery path). The live SSE
  // subscription is the noted upgrade — disabled here so it doesn't reconnect-loop
  // against a bridge that only serves snapshots.
  useEffect(() => {
    void store.loadRuns({ workspaceId });
    const id = setInterval(() => void store.loadRuns({ workspaceId }), 2500);
    return () => clearInterval(id);
  }, [store, workspaceId]);
  useAgentSubscription({ enabled: false, workspaceId });

  const { pending, requestCancel, undoCancel } = useDeferredCancel(workspaceId);

  // Stable callback identities so `observer`'s built-in shallow-prop memo can skip
  // unchanged rows — the immutable reducer keeps unchanged runs referentially equal,
  // so one event repaints only its own row instead of the whole list. (#9, #3)
  const onCommand = useCallback(
    (command: TAgentCommand) => void store.runCommand({ workspaceId, command }),
    [store, workspaceId]
  );
  const onDismiss = useCallback((runId: string) => store.dismissRun(runId), [store]);

  const grouped = store.visibleGrouped;
  const empty = GROUPS.every((g) => grouped[g.key].length === 0);
  // `done` is newest-first, so the first answered run is the most recent one — it auto-opens.
  const newestAnsweredId = grouped.done.find((r) => r.status === "succeeded" && !!r.result?.summary)?.id;

  return (
    <div className="h-full overflow-auto">
      {empty && <div className="p-6 text-13 text-tertiary">No agent activity yet.</div>}
      {GROUPS.map((g) =>
        grouped[g.key].length ? (
          <div key={g.key}>
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <span className="text-11 tracking-wide text-placeholder uppercase">{g.label}</span>
              {/* Bulk-dismiss the completed group (client-local hide). (#5) */}
              {g.key === "done" && (
                <button
                  className="rounded text-11 text-tertiary hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:outline-none"
                  onClick={() => store.dismissAllDone()}
                >
                  Clear all
                </button>
              )}
            </div>
            {grouped[g.key].map((run) => (
              <AgentRunRow
                key={run.id}
                run={run}
                onCommand={onCommand}
                onRequestCancel={requestCancel}
                onUndoCancel={undoCancel}
                pendingCancel={pending.has(run.id)}
                onDismiss={g.key === "done" ? onDismiss : undefined}
                answerAutoOpen={run.id === newestAnsweredId}
              />
            ))}
          </div>
        ) : null
      )}
    </div>
  );
});
