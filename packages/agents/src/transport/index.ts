/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TAgentEvent } from "../types/events";

/**
 * PROVISIONAL CONTRACT.
 *
 * Real-time seam. Deliberately abstracts the wire protocol so the concrete
 * mechanism (SSE, WebSocket via the `live` app, or SWR polling) can be chosen
 * during design without touching consumers. Research favors pushing
 * milestone-level events for background runs rather than token streams.
 */
export interface IAgentEventTransport {
  /**
   * Subscribe to live events for one or more runs in a workspace.
   * Returns an unsubscribe handle. The `sequence` on each event lets a
   * consumer detect gaps and reconcile via IAgentService after reconnect.
   */
  subscribe(params: {
    workspaceId: string;
    runIds?: string[];
    onEvent: (event: TAgentEvent) => void;
    onStatusChange?: (connected: boolean) => void;
  }): TAgentTransportSubscription;
}

export type TAgentTransportSubscription = {
  unsubscribe: () => void;
};
