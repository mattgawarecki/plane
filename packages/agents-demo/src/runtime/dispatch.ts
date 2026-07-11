/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { TAgentEvent, TAgentRun, TAgentTarget } from "@plane/agents";
import type { PlaneResources } from "../client/resources";
import { buildTools, SYSTEM_PROMPT, type TToolContext } from "./tools";

export type TDispatchDeps = {
  anthropic: Anthropic;
  resources: PlaneResources;
  /** Receives fully-formed contract events (console sink now, panel later). */
  emit: (event: TAgentEvent) => void;
  /** Human-in-the-loop gate for irreversible actions. */
  requestApproval: TToolContext["requestApproval"];
  /** Timestamp source (injected so the pure parts stay testable). */
  now: () => string;
  workspaceId: string;
  target?: TAgentTarget;
  /** Called with the seed run BEFORE events flow, so a consumer (e.g. the bridge
   *  server) can register it — the reducer ignores events for unknown runs. */
  onRunStart?: (run: TAgentRun) => void;
  model?: string;
};

/**
 * Interpret one natural-language request and act on Plane through the tools.
 * Ask → read tools + a text answer; Delegate → create/assign; irreversible →
 * gated. Emits a single run's worth of contract events as it goes.
 */
export async function dispatch(deps: TDispatchDeps, request: string): Promise<{ runId: string; answer: string }> {
  const runId = `run_${crypto.randomUUID().slice(0, 8)}`;
  const nowTs = deps.now();
  const run: TAgentRun = {
    id: runId,
    agentKey: "dispatch",
    title: request.length > 80 ? `${request.slice(0, 77)}…` : request,
    status: "running",
    workspaceId: deps.workspaceId,
    initiatedBy: "demo",
    createdAt: nowTs,
    updatedAt: nowTs,
    ...(deps.target ? { target: deps.target } : {}),
  };
  deps.onRunStart?.(run);

  let sequence = 0;
  const emit: TToolContext["emit"] = (partial) =>
    deps.emit({ ...partial, runId, sequence: sequence++, timestamp: deps.now() } as TAgentEvent);

  emit({ type: "status_changed", payload: { status: "running" } });

  const tools = buildTools({ resources: deps.resources, emit, requestApproval: deps.requestApproval });

  const final = await deps.anthropic.beta.messages.toolRunner({
    model: deps.model ?? "claude-opus-4-8",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools,
    messages: [{ role: "user", content: request }],
  });

  const answer = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // Store the FULL answer — the panel collapses/ellipsifies for display. A hard
  // char-slice here would cut mid-word with no ellipsis (a bad look in the UI).
  emit({ type: "completed", payload: { status: "succeeded", result: { summary: answer } } });
  return { runId, answer };
}
