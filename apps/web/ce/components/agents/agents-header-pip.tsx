/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useAgentCount } from "@/plane-web/hooks/agents/use-agent-count";

/** Ambient tier: a quiet pip + count. Pulses only while runs are active. */
export const AgentsHeaderPip = observer(
  ({ workspaceId, enabled, onClick }: { workspaceId: string; enabled: boolean; onClick: () => void }) => {
    const count = useAgentCount({ enabled, workspaceId });
    return (
      <button
        className="text-sm text-custom-text-200 inline-flex items-center gap-1.5"
        onClick={onClick}
        aria-label="Agents"
      >
        <span
          className={`h-2 w-2 rounded-full ${count > 0 ? "motion-safe:animate-pulse" : "bg-custom-background-80"}`}
          style={count > 0 ? { backgroundColor: "var(--color-label-indigo-text)" } : undefined}
        />
        <span>Agents</span>
        {count > 0 && <span className="text-xs text-custom-text-300">{count}</span>}
      </button>
    );
  }
);
