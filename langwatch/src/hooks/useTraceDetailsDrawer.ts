import { OrganizationUserRole } from "@prisma/client";
import { useCallback } from "react";
import type { DrawerProps } from "../components/drawerRegistry";
import { useDrawer } from "./useDrawer";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { useUpgradeModalStore } from "../stores/upgradeModalStore";

/**
 * Hook that wraps trace detail drawer opening with EXTERNAL user restriction.
 *
 * When the user has the EXTERNAL organization role, clicking to open a trace
 * detail drawer shows the lite member restriction modal instead of opening
 * the drawer. This prevents lite members from accessing trace debugging data.
 *
 * For all other roles, delegates directly to `openDrawer("traceDetails", ...)`.
 */
export function useTraceDetailsDrawer() {
  const { openDrawer } = useDrawer();
  const { organizationRole } = useOrganizationTeamProject();
  const { openLiteMemberRestriction } = useUpgradeModalStore();

  const openTraceDetailsDrawer = useCallback(
    (props?: Partial<DrawerProps<"traceDetails">>) => {
      if (organizationRole === OrganizationUserRole.EXTERNAL) {
        openLiteMemberRestriction({ resource: "traces" });
        return;
      }
      openDrawer("traceDetails", props);
    },
    [organizationRole, openDrawer, openLiteMemberRestriction],
  );

  return { openTraceDetailsDrawer };
}
