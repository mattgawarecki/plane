/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Component, type ReactNode } from "react";

/**
 * Crash isolation: a render error in the agents surface degrades to a local
 * fallback instead of white-screening the host app.
 */
export class AgentsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[agents] surface error", error);
  }

  render() {
    if (this.state.failed) return <div className="text-xs text-custom-text-400 p-4">Agents unavailable.</div>;
    return this.props.children;
  }
}
