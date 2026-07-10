/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import { AgentEventTransport, type IAgentSocket } from "./agent-event-transport";

function fakeSocket() {
  const s: IAgentSocket & { emitMessage: (d: unknown) => void; emitClose: () => void } = {
    onMessage: () => {},
    onClose: () => {},
    onError: () => {},
    close: vi.fn(),
    emitMessage(d) {
      this.onMessage(d);
    },
    emitClose() {
      this.onClose();
    },
  };
  return s;
}

describe("AgentEventTransport", () => {
  it("delivers parsed events to onEvent", () => {
    const socket = fakeSocket();
    const t = new AgentEventTransport("ws://x", () => socket);
    const events: unknown[] = [];
    t.subscribe({ workspaceId: "w1", onEvent: (e) => events.push(e) });
    socket.emitMessage({ runId: "r1", sequence: 1, timestamp: "t", type: "progress", payload: { percent: 10 } });
    expect(events).toHaveLength(1);
  });

  it("reports disconnect via onStatusChange and never throws on a bad payload", () => {
    const socket = fakeSocket();
    const t = new AgentEventTransport("ws://x", () => socket);
    const statuses: boolean[] = [];
    t.subscribe({ workspaceId: "w1", onEvent: () => {}, onStatusChange: (c) => statuses.push(c) });
    expect(() => socket.emitMessage("not-json{")).not.toThrow();
    socket.emitClose();
    expect(statuses).toEqual([true, false]);
  });

  it("closes the socket on unsubscribe", () => {
    const socket = fakeSocket();
    const t = new AgentEventTransport("ws://x", () => socket);
    const sub = t.subscribe({ workspaceId: "w1", onEvent: () => {} });
    sub.unsubscribe();
    expect(socket.close).toHaveBeenCalled();
  });
});
