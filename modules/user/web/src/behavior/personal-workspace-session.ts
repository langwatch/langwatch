/** Reads for personal-workspace screens: org, project, actor, bound via host. */

import { useMemo } from "react";
import {
  usePersonalWorkspaceHost,
  type PersonalActor,
  type PersonalDeployment,
  type PersonalOrganization,
  type PersonalProject,
} from "../model/personal-workspace-host.ts";

/**
 * The organization role that caps what a member's role bindings can do.
 *
 * Named as a string rather than imported from the generated Prisma client,
 * which is server code a web package may not reach. The one value the personal
 * surfaces compare against is this one.
 */
export const EXTERNAL_ORGANIZATION_ROLE = "EXTERNAL";

export type PersonalScopeReading = {
  organization: PersonalOrganization | undefined;
  project: PersonalProject | undefined;
  /** False until the organization graph has answered. */
  isResolved: boolean;
  hasPermission: (permission: string) => boolean;
};

export function useOrganizationTeamProject(): PersonalScopeReading {
  const host = usePersonalWorkspaceHost();
  return useMemo(
    () => ({
      organization: host.organization(),
      project: host.project(),
      isResolved: host.isScopeResolved(),
      hasPermission: (permission: string) => host.hasPermission(permission),
    }),
    [host],
  );
}

/** Who is signed in, for the profile fields and the avatar control. */
export function useCurrentUser(): PersonalActor | null {
  return usePersonalWorkspaceHost().currentUser();
}

/**
 * Whether this reader's organization gives them view-only access.
 *
 * A lite member is a member on the EXTERNAL organization role: reads work,
 * writes do not, and their own workspace keeps nothing they add to it. The
 * personal surfaces say so rather than letting the page look broken.
 */
export function useLiteMemberGuard(): { isLiteMember: boolean } {
  const host = usePersonalWorkspaceHost();
  return { isLiteMember: host.organizationRole() === EXTERNAL_ORGANIZATION_ROLE };
}

/** What kind of deployment this is, and where it answers. */
export function usePersonalDeployment(): PersonalDeployment {
  return usePersonalWorkspaceHost().deployment();
}
