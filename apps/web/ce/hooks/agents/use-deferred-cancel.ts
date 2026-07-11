/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useAgentStore } from "./use-agent-store";

export const CANCEL_UNDO_MS = 5000;

/**
 * Recovery model: a hard Cancel is NOT dispatched immediately. It's held for
 * CANCEL_UNDO_MS behind an inline Undo — if undone, the `cancel` command is
 * never sent and the agent never stopped. Pause (resumable) is the one-tap
 * default; this covers the rarer destructive Cancel.
 *
 * Correctness invariant: **while the Undo button is visible, clicking it always
 * prevents the cancel.** The subtlety is the commit edge — the timer fires, and
 * React unmounts the button a frame LATER (state is async), leaving a brief
 * visible-but-dead button. We close that gap two ways: (1) `flushSync` unmounts
 * the button synchronously *before* the command is sent, and (2) a synchronous
 * `committed` ref hard-guards undo. No render-lag window remains.
 */
export const useDeferredCancel = (workspaceId: string) => {
  const store = useAgentStore();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Cancels already committed (sent). Synchronous ref — undo checks it without
  // waiting for a render, and it can never be visible + committed at once.
  const committed = useRef<Set<string>>(new Set());

  const clear = useCallback((runId: string) => {
    const tm = timers.current.get(runId);
    if (tm) clearTimeout(tm);
    timers.current.delete(runId);
    setPending((prev) => {
      const next = new Set(prev);
      next.delete(runId);
      return next;
    });
  }, []);

  const requestCancel = useCallback(
    (runId: string) => {
      committed.current.delete(runId);
      setPending((prev) => new Set(prev).add(runId));
      const tm = setTimeout(() => {
        // Window closed. Mark committed + unmount the button SYNCHRONOUSLY, then send.
        // Order matters: no frame exists where the button is on screen after commit.
        committed.current.add(runId);
        flushSync(() => clear(runId));
        void store.runCommand({ workspaceId, command: { runId, type: "cancel", payload: {} } });
      }, CANCEL_UNDO_MS);
      timers.current.set(runId, tm);
    },
    [clear, store, workspaceId]
  );

  const undoCancel = useCallback(
    (runId: string) => {
      if (committed.current.has(runId)) return; // already sent — nothing to undo
      clear(runId); // clearTimeout → the cancel command is never sent
    },
    [clear]
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((tm) => clearTimeout(tm));
  }, []);

  return { pending, requestCancel, undoCancel };
};
