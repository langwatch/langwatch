import { OrganizationUserRole } from "@prisma/client";
import { useRouter } from "next/router";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";

/**
 * Routes where lite members (EXTERNAL organization role) are allowed to interact.
 * All other project routes will show a restriction overlay.
 *
 * Uses Next.js template paths (e.g., `/[project]/analytics`), NOT resolved URLs.
 */
const LITE_MEMBER_ALLOWED_PATHS: Array<{ path: string; exact: boolean }> = [
  { path: "/[project]", exact: true },
  { path: "/[project]/analytics", exact: false },
  { path: "/[project]/messages", exact: true },
  { path: "/[project]/experiments", exact: false },
  { path: "/[project]/simulations", exact: false },
  { path: "/[project]/evaluations", exact: true },
];

function isPathAllowed(pathname: string): boolean {
  return LITE_MEMBER_ALLOWED_PATHS.some(({ path, exact }) => {
    if (exact) {
      return pathname === path;
    }
    return pathname === path || pathname.startsWith(path + "/");
  });
}

/**
 * Guard hook that determines whether the current user is a lite member
 * and whether the current route is restricted for their role.
 *
 * Lite members are users with the EXTERNAL organization role.
 * They can view observability pages but cannot access engineering-level
 * debugging or configuration tools.
 *
 * @returns `isLiteMember` - true if the user has the EXTERNAL organization role
 * @returns `isRestricted` - true if the user is a lite member AND on a restricted route
 */
export function useLiteMemberGuard(): {
  isLiteMember: boolean;
  isRestricted: boolean;
} {
  const { organizationRole } = useOrganizationTeamProject();
  const router = useRouter();

  const isLiteMember = organizationRole === OrganizationUserRole.EXTERNAL;

  if (!isLiteMember) {
    return { isLiteMember: false, isRestricted: false };
  }

  const isRestricted = !isPathAllowed(router.pathname);

  return { isLiteMember, isRestricted };
}
