/**
 * Session, workspace and address state for the navigation shell. Moved from
 * `platform/app/src/features/navigation/shell/useNavigationV2ShellState.ts`.
 */

import { useBreakpointValue } from "@langwatch/design-system/primitives";
import { FrontendFlags, type FrontendFeatureFlag } from "@langwatch/feature-flag-contract";
import type { NavigationProject, NavigationUser } from "@langwatch/navigation-contract";
import { useSyncExternalStore } from "react";

import { belongsToNoOrganization } from "../model/belongs-to-no-organization.ts";
import {
  honourDashboardsSidebarHint,
  readDashboardsSidebarHint,
  subscribeToDashboardsSidebarHint,
} from "../model/dashboards-sidebar-hint.ts";
import { showsDevelopmentIndicator, useNavigationHost } from "../model/navigation-host.ts";
import type { OpenBoard } from "../model/open-board.ts";
import { type ProductId, productFromPathname } from "../model/products.ts";
import {
  projectNavItemAt,
  toProjectRoutePattern,
  type ProjectNavItem,
} from "../model/project-nav-items.ts";
import {
  isSwitchedOffProductAt,
  resolveShellRoute,
  type SeatRefusal,
  type ShellRoute,
} from "../model/resolve-shell-route.ts";
import { SHELL_SIDEBAR_WIDTH_COMPACT, shellSidebarWidth } from "../model/shell-layout.ts";
import { useSidebarWidthStore } from "./sidebar-width.store.ts";
import { useIsMobileViewport } from "./use-is-mobile-viewport.ts";
import { useOpenBoard } from "./use-open-board.ts";
import { useOrganizationDashboardsArea } from "./use-organization-dashboards-area.ts";
import { useOrganizationLibrary } from "./use-product-home.ts";
import { useProjectAddressDestination } from "./use-project-address-redirect.ts";
import { useReachableProducts } from "./use-reachable-products.ts";

export interface NavigationShellReadyState {
  status: "ready";
  user: NavigationUser;
  project: NavigationProject | undefined;
  /** The destination on screen, when the project menu names it. */
  currentRoute: ProjectNavItem | undefined;
  /** Null on the settings detour, which is not a product. */
  activeProductId: ProductId | null;
  isSettingsRoute: boolean;
  /** The page's product is one the viewer's seat does not reach; null when it opens. */
  seatRefusal: SeatRefusal | null;
  /** The board the address opens, with the organization's library on; null otherwise. */
  openBoard: OpenBoard | null;
  /** A development build, unless it asked to hide the badge. */
  showDevelopmentIndicator: boolean;
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
  /** The root resolver for a reader with no organization: no chrome to draw, only the redirect. */
  | { status: "chromeless" }
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
  const { reachableProducts } = useReachableProducts();
  const projectId = host.project()?.id;
  const storedHint = useSyncExternalStore(
    subscribeToDashboardsSidebarHint,
    () => readDashboardsSidebarHint({ projectId }),
    () => null,
  );
  const sidebarHint = honourDashboardsSidebarHint({ hint: storedHint, reachableProducts });
  const organizationLibrary = useOrganizationDashboardsArea();
  const hasOrganizationLibrary = useOrganizationLibrary();
  const board = useOpenBoard({ enabled: hasOrganizationLibrary === true });
  const projectAddressDestination = useProjectAddressDestination();
  const rememberedWidth = useSidebarWidthStore((state) => state.rememberedWidth);

  const user = host.currentUser();
  const project = host.project();
  const team = host.team();
  const pathname = host.pathname();

  const hasUnresolvedProjectParam = host.projectParam() !== void 0 && !host.isLoading() && !project;
  if (hasUnresolvedProjectParam) {
    return { status: "not-found" };
  }
  const areaState = organizationAreaState({
    host,
    pathname,
    organizationLibrary,
    projectAddressDestination,
  });
  if (areaState !== null) {
    return areaState;
  }

  // A board homed where the seat cannot go opens in the Dashboards chrome instead.
  const boardHome = board.openBoard?.homeProduct;
  const route = resolveShellRoute({
    pathname,
    isPersonalScope,
    isOrgScope,
    isOnOwnPersonalProject: !!team?.isPersonal && team.ownerUserId === user?.id,
    organizationRole: host.organizationRole(),
    sidebarHint,
    boardHomeProduct: boardHome && reachableProducts.includes(boardHome) ? boardHome : null,
    hasOrganizationLibrary: hasOrganizationLibrary === true,
  });
  // Which chrome a Dashboards address draws waits on the library's flags and the board's home.
  const isDashboardsChromePending =
    productFromPathname(pathname) === "dashboards" &&
    (hasOrganizationLibrary === void 0 || board.isLoading);

  if (user && route.isResolverRoute && isOrgless(host)) {
    return { status: "chromeless" };
  }

  if (
    !user ||
    organizationLibrary === "loading" ||
    isDashboardsChromePending ||
    isShellDataPending({ host, route })
  ) {
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
    seatRefusal: route.seatRefusal,
    openBoard: board.openBoard,
    showDevelopmentIndicator: showsDevelopmentIndicator(host.deployment()),
    isCompactSidebar,
    isMobile,
    menuWidth: isCompactSidebar
      ? SHELL_SIDEBAR_WIDTH_COMPACT
      : `${shellSidebarWidth({ remembered: rememberedWidth })}px`,
  };
}

/** What the organization's Dashboards area settles before any chrome; null lets the shell draw. */
function organizationAreaState({
  host,
  pathname,
  organizationLibrary,
  projectAddressDestination,
}: {
  host: ReturnType<typeof useNavigationHost>;
  pathname: string;
  organizationLibrary: ReturnType<typeof useOrganizationDashboardsArea>;
  projectAddressDestination: string | null;
}): NavigationShellState | null {
  const isFlagOff = (flag: FrontendFeatureFlag) => {
    const reading = host.featureFlag(FrontendFlags[flag]);
    return !reading.isLoading && !reading.enabled;
  };
  // The organization's library is about no project, so its flags are the organization's.
  const isClosed =
    organizationLibrary === "elsewhere"
      ? isSwitchedOffProductAt({ pathname, isFlagOff })
      : organizationLibrary === "closed";
  if (isClosed) return { status: "not-found" };
  // With the library's flag off the address reads as before: a project it forwards to, if any.
  if (organizationLibrary !== "legacy") return null;
  const isForwarding = projectAddressDestination !== null || host.isLoading();
  return isForwarding ? { status: "loading" } : { status: "not-found" };
}

function isOrgless(host: ReturnType<typeof useNavigationHost>): boolean {
  return belongsToNoOrganization({
    isWorkspaceResolving: host.isLoading(),
    organization: host.organization(),
    organizations: host.organizations(),
  });
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
  // The root resolver draws as soon as the organization is known: it needs the
  // host mounted, not a project — and it is what CHOOSES the project.
  if (route.isResolverRoute || route.isPersonalScopeRoute || route.isOrgScopeRoute) return false;
  return !host.team() || !host.project();
}
