/**
 * An organization-level board that only its project lists (Project scope, or Only me) makes that
 * project the one in view, so the sidebar's project-scoped list shows the board it is on.
 */

import { useEffect } from "react";

import { useNavigationHost } from "../model/navigation-host.ts";
import { isOrganizationDashboardsPath } from "../model/products.ts";

type OwnedBoard = {
  scope: string;
  project: { id: string; slug: string } | null;
};

export function useFollowBoardProject({ board }: { board: OwnedBoard | undefined }): void {
  const host = useNavigationHost();
  const inViewId = host.project()?.id;
  const owner = board && board.scope !== "ORGANIZATION" ? board.project : null;
  const isOrganizationAddress = isOrganizationDashboardsPath(host.pathname());
  const team = owner
    ? host.openableTeams().find(({ projects }) => projects.some(({ id }) => id === owner.id))
    : void 0;
  const teamId = team?.id;
  const ownerId = owner?.id;
  const ownerSlug = owner?.slug;
  useEffect(() => {
    if (!ownerId || !ownerSlug || !teamId) return;
    if (!isOrganizationAddress || ownerId === inViewId) return;
    host.rememberScope({ teamId, projectSlug: ownerSlug });
  }, [host, ownerId, ownerSlug, teamId, isOrganizationAddress, inViewId]);
}
