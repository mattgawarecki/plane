/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
import type { TAgentCommand, TAgentRun } from "@plane/agents";
import { useAgentStore } from "@/plane-web/hooks/agents/use-agent-store";

const glyph = (status: string) =>
  status === "succeeded" ? "✓" : status === "running" ? "▶" : status === "failed" ? "✕" : "·";

const SteerBox = ({ placeholder, onSubmit }: { placeholder: string; onSubmit: (v: string) => void }) => {
  const [value, setValue] = useState("");
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) {
          onSubmit(value.trim());
          setValue("");
        }
      }}
    >
      <input
        className="text-xs border-custom-border-300 bg-custom-background-90 text-custom-text-100 flex-1 rounded border px-2 py-1"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        className="text-xs border-custom-border-300 text-custom-text-200 rounded border px-2.5 py-1"
        type="submit"
      >
        Send
      </button>
    </form>
  );
};

export const AgentRunDetail = observer(({ run, workspaceId }: { run: TAgentRun; workspaceId: string }) => {
  const store = useAgentStore();
  const send = (command: TAgentCommand) => void store.runCommand({ workspaceId, command });

  return (
    <div className="p-4">
      <ol className="text-xs space-y-1.5" aria-live="polite">
        {(run.steps ?? []).map((s) => (
          <li key={s.id} className="text-custom-text-200 flex gap-2">
            <span className="text-custom-text-400 w-3 text-center">{glyph(s.status)}</span>
            <span>{s.label}</span>
          </li>
        ))}
        {(run.steps ?? []).length === 0 && <li className="text-custom-text-400">No steps yet.</li>}
      </ol>

      {run.status === "waiting_for_input" && (
        <SteerBox
          placeholder="Answer the agent…"
          onSubmit={(v) => send({ runId: run.id, type: "provide_input", payload: { promptId: "", response: v } })}
        />
      )}
      {run.status === "running" && (
        <SteerBox
          placeholder="Steer this run…"
          onSubmit={(v) => send({ runId: run.id, type: "correct", payload: { guidance: v } })}
        />
      )}
      {run.status === "awaiting_approval" && (
        <div className="mt-3 flex gap-2">
          <button
            className="text-xs rounded px-2.5 py-1 font-medium text-white"
            style={{ backgroundColor: "var(--color-label-indigo-text)" }}
            onClick={() => send({ runId: run.id, type: "approve", payload: { approvalId: "" } })}
          >
            Approve
          </button>
          <button
            className="text-xs border-custom-border-300 text-custom-text-200 rounded border px-2.5 py-1"
            onClick={() => send({ runId: run.id, type: "reject", payload: { approvalId: "" } })}
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
});
