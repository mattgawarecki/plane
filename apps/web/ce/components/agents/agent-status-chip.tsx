/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAgentRunStatus } from "@plane/agents";
import { statusPresentation, type TAgentTone } from "./status-presentation";

// Map semantic tone → Plane's theme-aware label color vars (auto-adapt to theme).
const TONE_LABEL: Record<TAgentTone, string> = {
  live: "indigo",
  attention: "yellow",
  success: "emerald",
  fail: "crimson",
  queued: "grey",
};

export const AgentStatusChip = ({ status }: { status: TAgentRunStatus }) => {
  const { label, tone } = statusPresentation(status);
  const name = TONE_LABEL[tone];
  return (
    <span
      className="rounded px-1.5 py-0.5 text-10 font-medium tracking-wide uppercase"
      style={{ backgroundColor: `var(--color-label-${name}-bg)`, color: `var(--color-label-${name}-text)` }}
    >
      {label}
    </span>
  );
};
