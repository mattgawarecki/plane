/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";
import { useAgentsEnabled } from "@/plane-web/hooks/agents/use-agents-enabled";
import { AgentsErrorBoundary } from "./agents-error-boundary";
import { AgentsHeaderPip } from "./agents-header-pip";

/**
 * Header entry point: the ambient pip only. Toggling it flips `store.panelOpen`,
 * which the shell-mounted <AgentsDock/> observes — the panel lives in the shell
 * (a flex sibling of <main>) so it pushes content instead of overlaying it.
 *
 * The flag is evaluated BEFORE any hook that opens a socket/poll — flag-off
 * returns null, so it's byte-for-byte today's behavior with zero network.
 */
export const AgentsRoot = observer(({ workspaceId }: { workspaceId: string }) => {
  const enabled = useAgentsEnabled();
  const store = useAgentStore();

  if (!enabled) return null;

  // While the dock is open the pip lives inside the panel, so drop it from the header.
  if (store.panelOpen) return null;

  return (
    <AgentsErrorBoundary>
      <AgentsHeaderPip workspaceId={workspaceId} enabled={enabled} onClick={() => store.togglePanel()} />
    </AgentsErrorBoundary>
  );
});
