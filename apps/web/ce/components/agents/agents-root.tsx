/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { lazy, Suspense, useState } from "react";
import { useAgentsEnabled } from "@/plane-web/hooks/agents/use-agents-enabled";
import { AgentsErrorBoundary } from "./agents-error-boundary";
import { AgentsHeaderPip } from "./agents-header-pip";

// Lazy-loaded: the panel bundle isn't fetched until the flag is on and it opens.
const AgentsPanel = lazy(() => import("./agents-panel").then((m) => ({ default: m.AgentsPanel })));

/**
 * Single entry point for the agents surface, mounted in the workspace header.
 * The flag is evaluated BEFORE any hook that opens a socket/poll — flag-off
 * returns null, so it's byte-for-byte today's behavior with zero network.
 */
export const AgentsRoot = ({ workspaceId }: { workspaceId: string }) => {
  const enabled = useAgentsEnabled();
  const [open, setOpen] = useState(false);

  if (!enabled) return null;

  return (
    <AgentsErrorBoundary>
      <AgentsHeaderPip workspaceId={workspaceId} enabled={enabled} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className="border-custom-border-200 bg-custom-background-100 shadow-lg fixed top-14 right-0 bottom-0 z-20 w-[340px] border-l">
          <div className="border-custom-border-200 flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm text-custom-text-100 font-semibold">Agents</span>
            <button
              className="text-custom-text-300 hover:text-custom-text-100"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="h-[calc(100%-49px)]">
            <Suspense fallback={<div className="text-xs text-custom-text-400 p-4">Loading…</div>}>
              <AgentsPanel workspaceId={workspaceId} />
            </Suspense>
          </div>
        </div>
      )}
    </AgentsErrorBoundary>
  );
};
