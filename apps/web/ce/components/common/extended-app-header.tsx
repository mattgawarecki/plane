/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { observer } from "mobx-react";
import { useParams } from "react-router";
// components
import { AppSidebarToggleButton } from "@/components/sidebar/sidebar-toggle-button";
import { AgentsRoot } from "@/plane-web/components/agents/agents-root";
// hooks
import { useAppTheme } from "@/hooks/store/use-app-theme";
import { useProjectNavigationPreferences } from "@/hooks/use-navigation-preferences";

export const ExtendedAppHeader = observer(function ExtendedAppHeader(props: { header: ReactNode }) {
  const { header } = props;
  // params
  const { workspaceSlug, projectId, workItem } = useParams();
  // preferences
  const { preferences: projectPreferences } = useProjectNavigationPreferences();
  // store hooks
  const { sidebarCollapsed } = useAppTheme();
  // derived values
  const shouldShowSidebarToggleButton = projectPreferences.navigationMode === "ACCORDION" || (!projectId && !workItem);

  return (
    <>
      {sidebarCollapsed && shouldShowSidebarToggleButton && <AppSidebarToggleButton />}
      {/* flex-1 (not w-full) so the agents pip has room on the right */}
      <div className="min-w-0 flex-1">{header}</div>
      {/* Agents surface — renders null unless the flag is on (byte-for-byte today when off). */}
      {workspaceSlug && (
        <div className="flex items-center pr-2">
          <AgentsRoot workspaceId={workspaceSlug} />
        </div>
      )}
    </>
  );
});
