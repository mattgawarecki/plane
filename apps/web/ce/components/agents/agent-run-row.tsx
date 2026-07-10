/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import type { TAgentCommand, TAgentRun } from "@plane/agents";
import { AgentStatusChip } from "./agent-status-chip";

const BTN =
  "text-xs font-medium rounded px-2.5 py-1 border border-custom-border-300 text-custom-text-200 hover:text-custom-text-100";

type Props = {
  run: TAgentRun;
  onCommand: (c: TAgentCommand) => void;
  onRequestCancel: (runId: string) => void;
  onUndoCancel: (runId: string) => void;
  pendingCancel: boolean;
};

// `observer` so a MobX projection ref-swap re-renders this row as the run's state advances.
export const AgentRunRow = observer(({ run, onCommand, onRequestCancel, onUndoCancel, pendingCancel }: Props) => {
  const steps = run.progress?.totalSteps ?? 0;
  const done = run.progress?.currentStep ?? 0;

  return (
    <div className="border-custom-border-200 border-b px-4 py-3" role="status" aria-live="polite">
      <div className="text-sm text-custom-text-100 flex items-center gap-2 font-medium">
        <span className="truncate">{run.title}</span>
        <AgentStatusChip status={run.status} />
      </div>
      {run.target?.entityName && <div className="text-xs text-custom-text-300 mt-0.5">{run.target.entityName}</div>}

      {run.status === "running" && steps > 0 && (
        // Named steps, not a percent bar (per the design's status model).
        <div className="text-custom-text-400 mt-1.5 text-[11px]" aria-live="polite">
          step {done} of {steps}
        </div>
      )}

      {/* Recovery: Pause is the non-destructive default; Cancel is secondary and
          deferred behind an Undo (onRequestCancel/onUndoCancel). */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {run.status === "awaiting_approval" && (
          <>
            <button
              className="text-xs rounded px-2.5 py-1 font-medium text-white"
              style={{ backgroundColor: "var(--color-label-indigo-text)" }}
              onClick={() => onCommand({ runId: run.id, type: "approve", payload: { approvalId: "" } })}
            >
              Approve
            </button>
            <button
              className={BTN}
              onClick={() => onCommand({ runId: run.id, type: "reject", payload: { approvalId: "" } })}
            >
              Reject
            </button>
          </>
        )}

        {!pendingCancel && run.status === "running" && (
          <button className={BTN} onClick={() => onCommand({ runId: run.id, type: "pause", payload: {} })}>
            Pause
          </button>
        )}
        {!pendingCancel && run.status === "paused" && (
          <>
            <button
              className="text-xs rounded px-2.5 py-1 font-medium text-white"
              style={{ backgroundColor: "var(--color-label-emerald-text)" }}
              onClick={() => onCommand({ runId: run.id, type: "resume", payload: {} })}
            >
              Resume
            </button>
            <button className={BTN} onClick={() => onRequestCancel(run.id)}>
              Cancel run
            </button>
          </>
        )}
        {!pendingCancel && run.status === "queued" && (
          <button className={BTN} onClick={() => onRequestCancel(run.id)}>
            Cancel
          </button>
        )}
        {pendingCancel && (
          <button
            className="text-xs rounded border px-2.5 py-1 font-medium"
            style={{ borderColor: "var(--color-label-indigo-text)", color: "var(--color-label-indigo-text)" }}
            onClick={() => onUndoCancel(run.id)}
          >
            ↩ Undo stop
          </button>
        )}

        {run.status === "failed" && (
          <button className={BTN} onClick={() => onCommand({ runId: run.id, type: "retry", payload: {} })}>
            Retry
          </button>
        )}
        {run.status === "succeeded" && run.result?.reviewUrl && (
          <a className="text-xs text-custom-primary-100 py-1 font-medium" href={run.result.reviewUrl}>
            Review changes →
          </a>
        )}
      </div>
    </div>
  );
});
