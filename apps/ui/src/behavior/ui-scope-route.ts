/**
 * What the address bar says about the scope, read directly from
 * `react-router`: personal workspace is "no `:project` segment matched
 * and the first path segment is `me`" — so `/me/traces` stays a project.
 */

import { useMemo } from "react";
import { matchPath, useLocation, useParams, useSearchParams } from "react-router";
import type { UiScopeRoute } from "../model/ui-scope";

/**
 * The addresses that render without a session, in this router's pattern
 * syntax. Only the share page carries a scope, in one read.
 */
export const UI_PUBLIC_ROUTES: readonly string[] = [
  "/share/:id",
  "/auth/signin",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
  "/auth/error",
];

/** The personal workspace's own top-level segment. */
const PERSONAL_SCOPE_SEGMENT = "me";

export function isUiPublicRoute(pathname: string): boolean {
  return UI_PUBLIC_ROUTES.some((pattern) => matchPath(pattern, pathname) !== null);
}

/** The scope facts of the current address, plus what a share viewer needs. */
export type UiRouteReading = UiScopeRoute & {
  readonly pathname: string;
  /** The share token, on the page that takes one. */
  readonly shareToken: string;
  readonly isPublicRoute: boolean;
};

export function useUiRouteReading(): UiRouteReading {
  const params = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const projectParam = params.project;
  const teamParam = searchParams.get("team");
  const shareToken = typeof params.id === "string" ? params.id : "";
  const pathname = location.pathname;

  // Held stable across renders: the scope resolution and everything memoised
  // on it re-run when this reading changes, and a fresh object every render
  // would mean re-running all of it on every render.
  return useMemo(() => {
    const [firstSegment] = pathname.replace(/^\/+/, "").split("/");
    return {
      ...(projectParam !== void 0 ? { projectParam } : {}),
      ...(teamParam !== null ? { teamParam } : {}),
      // A page under a matched `:project` is about that project whatever its
      // slug spells; only a page the router matched WITHOUT one can be the
      // personal workspace.
      isPersonalScopeRoute: projectParam === void 0 && firstSegment === PERSONAL_SCOPE_SEGMENT,
      pathname,
      shareToken,
      isPublicRoute: isUiPublicRoute(pathname),
    };
  }, [projectParam, teamParam, shareToken, pathname]);
}
