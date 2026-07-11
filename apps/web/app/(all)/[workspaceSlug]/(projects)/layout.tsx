/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Outlet } from "react-router";
import { ProjectsAppPowerKProvider } from "@/components/power-k/projects-app-provider";
// plane web components
import { ProjectAppSidebar } from "./_sidebar";
import { ExtendedProjectSidebar } from "./extended-project-sidebar";
// plane web components
import { AgentsDock } from "@/plane-web/components/agents/agents-dock";

function WorkspaceLayout() {
  return (
    <>
      <ProjectsAppPowerKProvider />
      {/* Two side-by-side rounded panels with a small gap: the app frame, and the
          agents dock. gap only shows when the dock is present (single child = no gap). */}
      <div className="flex h-full w-full gap-1.5">
        <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-subtle">
          <div id="full-screen-portal" className="absolute inset-0 w-full" />
          <div className="relative flex size-full overflow-hidden">
            <ProjectAppSidebar />
            <ExtendedProjectSidebar />
            {/* flex-1 min-w-0 (not w-full) so the frame shrinks to fit instead of overflowing. */}
            <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-surface-1">
              <Outlet />
            </main>
          </div>
        </div>
        {/* Its own rounded panel — renders null unless the flag is on and the panel is open. */}
        <AgentsDock />
      </div>
    </>
  );
}

export default observer(WorkspaceLayout);
