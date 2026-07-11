/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import type { TAgentCommand, TAgentRun } from "@plane/agents";
import { CANCEL_UNDO_MS } from "@/plane-web/hooks/agents/use-deferred-cancel";
import { AgentStatusChip } from "./agent-status-chip";

// Shared focus ring — keyboard users get a visible target on every control. (#10)
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";
const BTN = `text-11 font-medium rounded px-2.5 py-1 min-h-8 border border-subtle-1 text-secondary hover:text-primary ${FOCUS}`;
const INDIGO = "var(--color-label-indigo-text)";

/**
 * Ask/Delegate answer: hidden by default and revealed on "Show more" — EXCEPT the
 * most-recently-answered run, which auto-opens (`autoOpen`). Open-state follows
 * `autoOpen` until the user clicks, after which their choice sticks — so a newer
 * completion auto-opens and collapses the previous one, but manual toggles persist.
 */
const AnswerBlock = ({ text, autoOpen }: { text: string; autoOpen: boolean }) => {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? autoOpen;
  return (
    <div className="mt-2">
      {open && <div className="mb-1 rounded border border-subtle bg-surface-2 p-2 text-13 text-secondary">{text}</div>}
      <button className={`rounded text-11 text-accent-primary ${FOCUS}`} onClick={() => setOverride(!open)}>
        {open ? "Show less" : "Show more"}
      </button>
    </div>
  );
};

/**
 * Deferred-cancel affordance: while the cancel is held, a fill drains left→right
 * across the button over CANCEL_UNDO_MS. When it reaches full, the timer commits
 * the cancel — so the visual and the deadline are the same thing. Click = undo.
 * Motion-reduce hides the fill (the label + click still work). (#13)
 */
const UndoStopButton = ({ onUndo }: { onUndo: () => void }) => {
  const [fill, setFill] = useState(false);
  useEffect(() => {
    // Kick the transition on the next frame so it animates from scaleX(0).
    const id = requestAnimationFrame(() => setFill(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <button
      className={`relative min-h-8 overflow-hidden rounded border px-2.5 py-1 text-11 font-medium ${FOCUS}`}
      style={{ borderColor: INDIGO, color: INDIGO }}
      onClick={onUndo}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-full origin-left motion-reduce:hidden"
        style={{
          backgroundColor: INDIGO,
          opacity: 0.15,
          transform: fill ? "scaleX(1)" : "scaleX(0)",
          transition: `transform ${CANCEL_UNDO_MS}ms linear`,
        }}
      />
      <span className="relative">↩ Undo stop</span>
    </button>
  );
};

type Props = {
  run: TAgentRun;
  onCommand: (c: TAgentCommand) => void;
  onRequestCancel: (runId: string) => void;
  onUndoCancel: (runId: string) => void;
  pendingCancel: boolean;
  /** Provided only for the "Recently done" group — shows a per-row dismiss ✕. */
  onDismiss?: (runId: string) => void;
  /** True for the most-recently-answered run — auto-opens its answer. */
  answerAutoOpen?: boolean;
};

// `observer` so a MobX projection ref-swap re-renders this row as the run's state advances.
export const AgentRunRow = observer(
  ({ run, onCommand, onRequestCancel, onUndoCancel, pendingCancel, onDismiss, answerAutoOpen }: Props) => {
    const steps = run.progress?.totalSteps ?? 0;
    const done = run.progress?.currentStep ?? 0;

    return (
      <div className="border-b border-subtle px-4 py-3" role="status" aria-live="polite">
        <div className="flex items-center gap-2">
          {/* Title takes the slack and truncates; status + ✕ sit together on the right. */}
          <span className="min-w-0 flex-1 truncate text-13 font-medium text-primary">{run.title}</span>
          <AgentStatusChip status={run.status} />
          {onDismiss && (
            <button
              className={`-m-1 rounded p-1 text-tertiary hover:text-primary ${FOCUS}`}
              onClick={() => onDismiss(run.id)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          )}
        </div>
        {run.target?.entityName && <div className="mt-0.5 text-11 text-tertiary">{run.target.entityName}</div>}

        {run.status === "running" && steps > 0 && (
          // Named steps, not a percent bar (per the design's status model).
          <div className="mt-1.5 text-11 text-placeholder" aria-live="polite">
            step {done} of {steps}
          </div>
        )}

        {/* Ask/Delegate ANSWER: collapsed by default, clean ellipsis when clamped.
          Full streamed answer (token deltas) is out of scope — no delta event. (#8) */}
        {run.status === "succeeded" && run.result?.summary && (
          <AnswerBlock text={run.result.summary} autoOpen={!!answerAutoOpen} />
        )}

        {/* Recovery: Pause is the non-destructive default; Cancel is secondary and
          deferred behind an Undo (onRequestCancel/onUndoCancel). */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {run.status === "awaiting_approval" && (
            <>
              <button
                className={`min-h-8 rounded px-2.5 py-1 text-11 font-medium text-white ${FOCUS}`}
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
                className={`min-h-8 rounded px-2.5 py-1 text-11 font-medium text-white ${FOCUS}`}
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
          {pendingCancel && <UndoStopButton onUndo={() => onUndoCancel(run.id)} />}

          {run.status === "failed" && (
            <button className={BTN} onClick={() => onCommand({ runId: run.id, type: "retry", payload: {} })}>
              Retry
            </button>
          )}
          {run.status === "succeeded" && run.result?.reviewUrl && (
            <a className="py-1 text-11 font-medium text-accent-primary" href={run.result.reviewUrl}>
              Review changes →
            </a>
          )}
        </div>
      </div>
    );
  }
);
