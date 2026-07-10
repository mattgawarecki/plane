/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IAgentSocket } from "./agent-event-transport";

/** Wrap a native browser WebSocket in the transport's minimal socket surface. */
export const createBrowserAgentSocket = (url: string): IAgentSocket => {
  const ws = new WebSocket(url);
  const socket: IAgentSocket = {
    onMessage: () => {},
    onClose: () => {},
    onError: () => {},
    close: () => ws.close(),
  };
  ws.addEventListener("message", (e) => socket.onMessage(e.data));
  ws.addEventListener("close", () => socket.onClose());
  ws.addEventListener("error", (e) => socket.onError(e));
  return socket;
};
