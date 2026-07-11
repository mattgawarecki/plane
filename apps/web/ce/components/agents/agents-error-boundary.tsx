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
    if (this.state.failed) {
      // Compact styled notice — reads well whether this boundary wraps the header
      // pip or the full dock body (not a jarring bare string).
      return (
        <div className="m-2 rounded border border-subtle bg-surface-2 p-3 text-center text-tertiary">
          <div className="text-13 font-medium text-secondary">Agents unavailable</div>
          <div className="mt-0.5 text-11">Couldn’t load this panel. Try reopening it.</div>
        </div>
      );
    }
    return this.props.children;
  }
}
