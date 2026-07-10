/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// store
import { CoreRootStore } from "@/store/root.store";
import { AgentStore } from "./agents/agent.store";
import type { ITimelineStore } from "./timeline";
import { TimeLineStore } from "./timeline";

export class RootStore extends CoreRootStore {
  timelineStore: ITimelineStore;
  agents: AgentStore;

  constructor() {
    super();

    this.timelineStore = new TimeLineStore(this);
    // Additive, CE-only — no core edits. Constructing the store opens no
    // connection; the panel/hooks drive load + subscribe lazily behind the flag.
    this.agents = new AgentStore(this);
  }
}
