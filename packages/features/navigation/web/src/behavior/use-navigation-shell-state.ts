/**
 * Session, workspace and address state for the navigation shell.
 *
 * Moved from
 * `platform/app/src/features/navigation/shell/useNavigationV2ShellState.ts`.
 * The shell renders one of three outcomes, so this reports a STATUS rather
 * than the raw parts: the project in the address does not exist, the data
 * needed to draw the chrome has not arrived, or everything the shell draws.
 *
 * Every read that used to be its own platform hook — the workspace, the
 * session, the public environment, the one-shot `?org=` selection and the
 * analytics identify — is now either the host or gone:
 *
 * - The workspace, the reader and the deployment come off the host.
 * - `useOrgQueryParamSelection` is the application's address handling, and it
 *   already runs above this shell rather than inside it.
 * - `usePostHogIdentify` did not travel. Product analytics is the
 *   application's, the line every family since the gateway has drawn.
 * - The Langy dock handshake did not travel either: the panel it reserves room
 *   for is mounted by the application, and a package that claimed a dock no
 *   host had opened would hold a shell nobody released.
 *
 * Specs: specs/navigation/product-switcher-navigation.feature,
 *        specs/navigation/icon-rail-navigation.feature
 */

import { useBreakpointValue } from "@chakra-ui/react";
import {
  useNavigationHost,
  type NavigationProject,
  type NavigationUser,
} from "../model/navigation-host";
import { SHELL_SIDEBAR_WIDTH_COMPACT, SHELL_SIDEBAR_WIDTH_EXPANDED } from "../model/shell-layout";
import {
  projectNavItemAt,
  toProjectRoutePattern,
  type ProjectNavItem,
} from "../model/project-nav-items";
import { resolveShellRoute, type ShellRoute } from "../model/resolve-shell-route";
import type { ProductId } from "../model/products";
import { useIsMobileViewport } from "./use-is-mobile-viewport";

export interface NavigationShellReadyState {
  status: "ready";
  user: NavigationUser;
  project: NavigationProject | undefined;
  /** The destination on screen, when the project menu names it. */
  currentRoute: ProjectNavItem | undefined;
  /** Null on the settings detour, which is not a product. */
  activeProductId: ProductId | null;
  isSettingsRoute: boolean;
  isDevelopment: boolean;
  isCompactSidebar: boolean;
  /** Phone-width viewport: the mobile bar + menu replace the sidebar chrome. */
  isMobile: boolean;
  /**
   * Width of the sidebar column, and with it the left edge of the content
   * column. The top bar and the content cap both read it here, so they cannot
   * drift apart.
   */
  menuWidth: string;
}

export type NavigationShellState =
  | { status: "not-found" }
  | { status: "loading" }
  | NavigationShellReadyState;

export function useNavigationShellState({
  isPersonalScope,
  isOrgScope,
}: {
  isPersonalScope: boolean;
  isOrgScope: boolean;
}): NavigationShellState {
  const isSmallScreen = useBreakpointValue({ base: true, lg: false }, { fallback: "lg" });
  const isMobile = useIsMobileViewport();
  const host = useNavigationHost();

  const user = host.currentUser();
  const project = host.project();
  const team = host.team();
  const pathname = host.pathname();

  if (host.projectParam() !== void 0 && !host.isLoading() && !project) {
    return { status: "not-found" };
  }

  const route = resolveShellRoute({
    pathname,
    isPersonalScope,
    isOrgScope,
    isOnOwnPersonalProject: !!team?.isPersonal && team.ownerUserId === user?.id,
  });

  if (!user || isShellDataPending({ host, route })) {
    return { status: "loading" };
  }

  const isCompactSidebar = isSmallScreen === true;

  return {
    status: "ready",
    user,
    project,
    currentRoute: projectNavItemAt(toProjectRoutePattern({ pathname, projectSlug: project?.slug })),
    activeProductId: route.activeProductId,
    isSettingsRoute: route.isSettingsRoute,
    isDevelopment: host.deployment().isDevelopment,
    isCompactSidebar,
    isMobile,
    menuWidth: isCompactSidebar ? SHELL_SIDEBAR_WIDTH_COMPACT : SHELL_SIDEBAR_WIDTH_EXPANDED,
  };
}

/**
 * Whether the chrome still misses data it needs to draw. A personal-scope
 * address needs no organization, and an organization-scope address needs no
 * project, so each scope waits only for its own parts.
 */
function isShellDataPending({
  host,
  route,
}: {
  host: ReturnType<typeof useNavigationHost>;
  route: ShellRoute;
}): boolean {
  if (host.isLoading()) return true;
  const organization = host.organization();
  if (!route.isPersonalScopeRoute && !(organization && host.organizations().length > 0)) {
    return true;
  }
  if (route.isPersonalScopeRoute || route.isOrgScopeRoute) return false;
  return !host.team() || !host.project();
}
