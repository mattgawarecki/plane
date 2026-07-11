/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";

// Shared focus ring — keyboard parity with the rest of the dock. (#10)
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong";

/**
 * Dock-footer composer: type a request → START a run via `store.dispatch`.
 * The new run surfaces on the next tick of the panel's 2500ms `loadRuns` poll,
 * so there is no optimistic insert here. Not an `observer` — it calls an action
 * but reads no observable store state.
 */
export const AgentDispatchInput = () => {
  const store = useAgentStore();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = value.trim();
  const disabled = trimmed.length === 0 || submitting;

  const submit = async () => {
    if (trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await store.dispatch(trimmed);
      setValue("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-subtle bg-surface-1 p-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={2}
        placeholder="Ask or delegate a task…"
        disabled={submitting}
        aria-label="Ask or delegate a task"
        className={`w-full resize-none rounded border border-subtle bg-surface-2 px-2.5 py-1.5 text-13 text-primary placeholder:text-placeholder ${FOCUS}`}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-11 text-tertiary">Enter to send · Shift+Enter for newline</span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={disabled}
          className={`min-h-8 rounded px-2.5 py-1 text-11 font-medium text-white disabled:opacity-50 ${FOCUS}`}
          style={{ backgroundColor: "var(--color-label-indigo-text)" }}
        >
          {submitting ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
};
