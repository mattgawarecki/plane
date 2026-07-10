/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { backoffDelay } from "@plane/agents";
import type { TAgentTransportSubscription } from "@plane/agents";
import { LIVE_BASE_URL } from "@plane/constants";
import { AgentEventTransport } from "@/plane-web/transport/agents/agent-event-transport";
import { createBrowserAgentSocket } from "@/plane-web/transport/agents/browser-socket";
import { useAgentStore } from "./use-agent-store";
import { shouldSubscribe } from "./subscription-policy";

/**
 * Opens a live subscription ONLY while watching (flag on + something to watch),
 * feeds events into the store, tears down on unmount / tab-hidden, and reconnects
 * with capped backoff + jitter. Lazy on purpose — bounds concurrent connections
 * to engaged users, not all logged-in users.
 */
export const useAgentSubscription = (p: { enabled: boolean; workspaceId: string; runIds?: string[] }) => {
  const store = useAgentStore();
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!shouldSubscribe({ enabled: p.enabled, hasWatchTargets: true }) || typeof document === "undefined") return;

    let sub: TAgentTransportSubscription | undefined;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const transport = new AgentEventTransport(LIVE_BASE_URL, createBrowserAgentSocket);
      sub = transport.subscribe({
        workspaceId: p.workspaceId,
        runIds: p.runIds,
        onEvent: (e) => store.ingestEvent(e),
        onStatusChange: (connected) => {
          if (connected) {
            attemptRef.current = 0;
          } else {
            const delay = backoffDelay(attemptRef.current++);
            timerRef.current = setTimeout(connect, delay + Math.floor(Math.random() * 250));
          }
        },
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") sub?.unsubscribe();
      else if (!cancelled) connect();
    };

    connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      sub?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.enabled, p.workspaceId, JSON.stringify(p.runIds), store]);
};
