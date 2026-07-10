/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { PlaneResources, TStateGroup } from "../client/resources";
import type { TAgentEvent } from "@plane/agents";

/**
 * A run emits events (steps, approvals, completion) as it works, and asks for
 * approval before anything destructive. The runtime supplies these; tests supply
 * fakes. This is the seam that ties tools to the visibility contract + the gate.
 */
export type TToolContext = {
  resources: PlaneResources;
  /** Emit a contract event for the journal / panel. */
  emit: (event: Omit<TAgentEvent, "runId" | "sequence" | "timestamp">) => void;
  /**
   * Block until a human approves a proposed irreversible action. Resolves true
   * on approve, false on reject. The runtime wires this to the panel's
   * approve/reject command; the tool never mutates until it resolves true.
   */
  requestApproval: (req: { approvalId: string; summary: string; irreversible?: boolean }) => Promise<boolean>;
};

const stepId = () => `st_${crypto.randomUUID().slice(0, 8)}`;

/** A tool run that records a step event around its work. */
async function withStep<T>(ctx: TToolContext, label: string, work: () => Promise<T>): Promise<T> {
  const id = stepId();
  ctx.emit({ type: "step_started", payload: { id, label, status: "running" } });
  try {
    const result = await work();
    ctx.emit({ type: "step_completed", payload: { id, label, status: "succeeded" } });
    return result;
  } catch (e) {
    ctx.emit({ type: "step_completed", payload: { id, label, status: "failed" } });
    throw e;
  }
}

/**
 * Build the tool set for one dispatched run. Descriptions are prescriptive about
 * WHEN to call each tool — Opus 4.8 under-reaches for tools otherwise.
 */
export function buildTools(ctx: TToolContext) {
  const { resources } = ctx;

  const searchWorkItems = betaZodTool({
    name: "search_work_items",
    description:
      "Find existing work items by topic or keyword. Call this FIRST when the user asks what exists, " +
      "what's in flight, or before you create/close anything, so you act on real items rather than guessing.",
    inputSchema: z.object({ query: z.string().describe("keywords, e.g. 'billing close'") }),
    run: async ({ query }) =>
      withStep(ctx, `Search: "${query}"`, async () => {
        const items = await resources.searchWorkItems(query);
        return JSON.stringify(items.slice(0, 20));
      }),
  });

  const createSubTask = betaZodTool({
    name: "create_sub_task",
    description:
      "Create a well-scoped sub-task under a parent work item when decomposing a larger request. " +
      "Give each a clear name and a short HTML description of the outcome. Call once per sub-task.",
    inputSchema: z.object({
      parentId: z.string(),
      name: z.string(),
      descriptionHtml: z.string().optional(),
      priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
    }),
    run: async ({ parentId, name, descriptionHtml, priority }) =>
      withStep(ctx, `Create sub-task: ${name}`, async () => {
        const wi = await resources.createSubIssue(parentId, {
          name,
          description_html: descriptionHtml,
          priority,
        });
        return `created ${wi.id}`;
      }),
  });

  const assign = betaZodTool({
    name: "assign_work_item",
    description:
      "Assign a work item to one or more project members (member UUIDs). Call after creating a task you can route.",
    inputSchema: z.object({ id: z.string(), assignees: z.array(z.string()) }),
    run: async ({ id, assignees }) =>
      withStep(ctx, `Assign ${id}`, async () => {
        await resources.updateWorkItem(id, { assignees });
        return "assigned";
      }),
  });

  const setStatus = betaZodTool({
    name: "set_status",
    description:
      "Move a work item to a state group (backlog/unstarted/started/completed/cancelled). " +
      "Use to reflect progress; NOT for bulk closing many items — use bulk_close for that.",
    inputSchema: z.object({
      id: z.string(),
      group: z.enum(["backlog", "unstarted", "started", "completed", "cancelled"]),
    }),
    run: async ({ id, group }) =>
      withStep(ctx, `Set ${id} → ${group}`, async () => {
        const state = await resources.resolveStateByGroup(group as TStateGroup);
        if (!state) return `no state for group ${group}`;
        await resources.updateWorkItem(id, { state: state.id });
        return `moved to ${state.name}`;
      }),
  });

  const addComment = betaZodTool({
    name: "add_comment",
    description:
      "Post a short first-person comment narrating what you did or found on a work item. " +
      "Use sparingly to leave a trail a human can follow — not after every action.",
    inputSchema: z.object({ id: z.string(), commentHtml: z.string() }),
    run: async ({ id, commentHtml }) =>
      withStep(ctx, `Comment on ${id}`, async () => {
        await resources.addComment(id, commentHtml);
        return "commented";
      }),
  });

  const bulkClose = betaZodTool({
    name: "bulk_close",
    description:
      "Close MULTIPLE work items at once (an irreversible cleanup). Call ONLY when the user has indicated a set " +
      "of items is done or superseded. This PAUSES for explicit human approval and closes nothing until approved — " +
      "do not assume it succeeded; read the result.",
    inputSchema: z.object({
      ids: z.array(z.string()).min(1),
      reason: z.string().describe("one line the human sees when approving"),
    }),
    run: async ({ ids, reason }) => {
      const approvalId = `ap_${crypto.randomUUID().slice(0, 8)}`;
      ctx.emit({
        type: "approval_requested",
        payload: { approvalId, summary: `close ${ids.length} items — ${reason}`, irreversible: true },
      });
      const approved = await ctx.requestApproval({
        approvalId,
        summary: `close ${ids.length} items — ${reason}`,
        irreversible: true,
      });
      if (!approved) return "declined by user — nothing was closed";
      return withStep(ctx, `Close ${ids.length} items`, async () => {
        const cancelled = await resources.resolveStateByGroup("cancelled");
        if (!cancelled) return "no cancelled state configured";
        await Promise.all(ids.map((id) => resources.updateWorkItem(id, { state: cancelled.id })));
        return `closed ${ids.length} items`;
      });
    },
  });

  return [searchWorkItems, createSubTask, assign, setStatus, addComment, bulkClose];
}

/** Rails for the runtime. Kept tight so a live LLM stays on-task on stage. */
export const SYSTEM_PROMPT = `You are an agent operating inside a LOCAL demo of Plane, a project-management tool.

You act only through the provided tools. When the user ASKS a question, use the read tools
(search_work_items) to gather facts, then answer in plain language — do not create or change anything.

When the user DELEGATES work (e.g. "ship the September billing close"), decompose it into a small set
of well-scoped sub-tasks with clear names and one-line outcome descriptions, create them under the
relevant parent, and assign where you can infer an owner. Prefer 3–6 sub-tasks over one giant task.

Anything irreversible — closing or deleting multiple items — MUST go through bulk_close, which pauses
for human approval. Never work around the gate. If approval is declined, adapt and continue without it.

Be concise. Narrate only what matters. When you have enough to act, act.`;
