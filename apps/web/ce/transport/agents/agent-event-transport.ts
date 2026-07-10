/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IAgentEventTransport, TAgentEvent, TAgentTransportSubscription } from "@plane/agents";

/** Minimal socket surface so the transport is testable with a fake. */
export interface IAgentSocket {
  onMessage: (data: unknown) => void;
  onClose: () => void;
  onError: (err: unknown) => void;
  close: () => void;
}

export type TAgentSocketFactory = (url: string) => IAgentSocket;

/** Parse a frame into an event; malformed frames are dropped, never thrown. */
const parseEvent = (data: unknown): TAgentEvent | null => {
  try {
    const obj = typeof data === "string" ? JSON.parse(data) : data;
    if (obj && typeof obj === "object" && "runId" in obj && "sequence" in obj && "type" in obj) {
      return obj as TAgentEvent;
    }
  } catch {
    // malformed frame — ignored so a bad payload can't crash the app
  }
  return null;
};

/**
 * Thin transport shim. Owns no reconnect/backoff (that's the hook's job) and no
 * business logic — it just delivers parsed events and reports connect/disconnect
 * via onStatusChange. All socket errors are caught here, never surfaced to React.
 */
export class AgentEventTransport implements IAgentEventTransport {
  constructor(
    private baseUrl: string,
    private factory: TAgentSocketFactory
  ) {}

  subscribe(params: {
    workspaceId: string;
    runIds?: string[];
    onEvent: (event: TAgentEvent) => void;
    onStatusChange?: (connected: boolean) => void;
  }): TAgentTransportSubscription {
    const socket = this.factory(`${this.baseUrl}/agent-events/${params.workspaceId}`);
    socket.onMessage = (data) => {
      const event = parseEvent(data);
      if (event) params.onEvent(event);
    };
    socket.onClose = () => params.onStatusChange?.(false);
    socket.onError = () => params.onStatusChange?.(false);
    params.onStatusChange?.(true);
    return { unsubscribe: () => socket.close() };
  }
}
