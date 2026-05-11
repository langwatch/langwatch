/**
 * Pure predicate controlling whether the Langy handle is mounted in a
 * given route. Extracted from DashboardLayout.tsx so it can be unit-tested
 * without rendering the full layout.
 *
 * Binds langy-baseline.feature § "Langy is available on every project page":
 *   - Langy IS visible on /[project]/* routes when the user is a member.
 *   - Langy is NOT visible on public pages, /ops/* routes, or any
 *     non-project route.
 */

export interface LangyVisibilityInput {
  /** True when rendering a publicly-shareable page (no auth required). */
  publicPage: boolean;
  /** True when the session user is a member of the project's team
   *  (or an org admin / impersonator / demo viewer — DashboardLayout
   *  computes this upstream and passes the boolean in). */
  userIsPartOfTeam: boolean;
  /** Next.js router pathname template — e.g. `/[project]/messages`. */
  pathname: string;
}

export function isProjectRoutePath(pathname: string): boolean {
  return (
    pathname === "/[project]" || pathname.startsWith("/[project]/")
  );
}

export function shouldShowLangy(input: LangyVisibilityInput): boolean {
  if (input.publicPage) return false;
  if (!input.userIsPartOfTeam) return false;
  if (!isProjectRoutePath(input.pathname)) return false;
  return true;
}
