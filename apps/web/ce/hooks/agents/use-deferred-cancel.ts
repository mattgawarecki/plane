/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "./use-agent-store";

export const CANCEL_UNDO_MS = 5000;

/**
 * Recovery model: a hard Cancel is NOT dispatched immediately. It's held for
 * CANCEL_UNDO_MS behind an inline Undo — if undone, the `cancel` command is
 * never sent and the agent never stopped. Pause (resumable) is the one-tap
 * default; this covers the rarer destructive Cancel.
 */
export const useDeferredCancel = (workspaceId: string) => {
  const store = useAgentStore();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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
      setPending((prev) => new Set(prev).add(runId));
      const tm = setTimeout(() => {
        clear(runId);
        void store.runCommand({ workspaceId, command: { runId, type: "cancel", payload: {} } });
      }, CANCEL_UNDO_MS);
      timers.current.set(runId, tm);
    },
    [clear, store, workspaceId]
  );

  const undoCancel = useCallback((runId: string) => clear(runId), [clear]); // command never sent

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((tm) => clearTimeout(tm));
  }, []);

  return { pending, requestCancel, undoCancel };
};
