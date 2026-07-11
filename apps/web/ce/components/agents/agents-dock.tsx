/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { lazy, Suspense, useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "react-router";
import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";
import { useAgentsEnabled } from "@/plane-web/hooks/agents/use-agents-enabled";
import { AgentsErrorBoundary } from "./agents-error-boundary";
import { AgentsHeaderPip } from "./agents-header-pip";
import { AgentDispatchInput } from "./agent-dispatch-input";

// Lazy-loaded: the panel bundle isn't fetched until the flag is on and it opens.
const AgentsPanel = lazy(() => import("./agents-panel").then((m) => ({ default: m.AgentsPanel })));

/**
 * Shell-mounted dock: an in-flow flex sibling of <main>. When open it occupies
 * its own 340px column, so the main UI stays fully visible and shrinks to fit
 * (no overlay, no z-index fight). Flag-off / closed renders null → zero footprint.
 */
export const AgentsDock = observer(() => {
  const enabled = useAgentsEnabled();
  const store = useAgentStore();
  const { workspaceSlug } = useParams();

  // Esc closes the dock (keyboard parity with the ✕). (#10)
  useEffect(() => {
    if (!store.panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") store.setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, store.panelOpen]);

  if (!enabled || !workspaceSlug || !store.panelOpen) return null;

  return (
    <AgentsErrorBoundary>
      {/* Own rounded panel (all four corners) matching the app frame's rounded-lg. */}
      <aside className="flex h-full w-[340px] shrink-0 flex-col overflow-hidden rounded-lg border border-subtle bg-surface-1">
        {/* h-11 matches the app header (app-header.tsx) so the two align. */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-subtle px-4">
          {/* Pip moves in-panel while open — click it (or ✕) to close. */}
          <AgentsHeaderPip workspaceId={workspaceSlug} enabled onClick={() => store.setPanelOpen(false)} />
          <button
            className="-m-1 rounded p-1 text-tertiary hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-strong focus-visible:outline-none"
            onClick={() => store.setPanelOpen(false)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={<div className="p-4 text-11 text-placeholder">Loading…</div>}>
            <AgentsPanel workspaceId={workspaceSlug} />
          </Suspense>
        </div>
        <AgentDispatchInput />
      </aside>
    </AgentsErrorBoundary>
  );
});
