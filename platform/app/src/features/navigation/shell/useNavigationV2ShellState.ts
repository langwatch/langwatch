import { useBreakpointValue } from "@chakra-ui/react";
import { useLayoutEffect } from "react";
import {
  LANGY_DOCK_GAP,
  LANGY_DOCKED_OFFSET,
} from "~/features/langy/logic/langyPanelLayout";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useOrgQueryParamSelection } from "~/hooks/useOrgQueryParamSelection";
import { usePostHogIdentify } from "~/hooks/usePostHogIdentify";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { findCurrentRoute } from "~/utils/routes";
import { resolveShellRoute, type ShellRoute } from "../logic/resolveShellRoute";
import type { ProductId } from "../products";
import {
  SHELL_SIDEBAR_WIDTH_COMPACT,
  SHELL_SIDEBAR_WIDTH_EXPANDED,
} from "./shellLayout";

type OrganizationTeamProject = ReturnType<typeof useOrganizationTeamProject>;
type AppSession = ReturnType<typeof useRequiredSession>["data"];
type SessionUser = NonNullable<AppSession>["user"];

export interface NavigationV2ShellReadyState {
  status: "ready";
  user: SessionUser;
  project: ReturnType<typeof useOrganizationTeamProject>["project"];
  currentRoute: ReturnType<typeof findCurrentRoute>;
  /** Null on the settings detour, which is not a product. */
  activeProductId: ProductId | null;
  isSettingsRoute: boolean;
  isDevelopment: boolean;
  isCompactSidebar: boolean;
  /**
   * Width of the sidebar column, and with it the left edge of the
   * content column. The top bar and the content cap both read it here,
   * so they cannot drift apart.
   */
  menuWidth: string;
  showPresenceMenuItem: boolean;
  /** Room the docked Langy panel takes inside the content row, in pixels. */
  langyDockInset: number;
}

export type NavigationV2ShellState =
  | { status: "not-found" }
  | { status: "loading" }
  | NavigationV2ShellReadyState;

/**
 * Session, organization, project and route state for the navigation-v2
 * shell. The shell renders one of three outcomes, so this reports a
 * status rather than the raw parts: the project in the address does not
 * exist, the data needed to draw the chrome is not ready, or everything
 * the shell draws.
 *
 * Specs: specs/navigation/product-switcher-navigation.feature,
 *        specs/navigation/icon-rail-navigation.feature
 */
export function useNavigationV2ShellState({
  isPersonalScope,
  isOrgScope,
}: {
  isPersonalScope: boolean;
  isOrgScope: boolean;
}): NavigationV2ShellState {
  const isSmallScreen = useBreakpointValue(
    { base: true, lg: false },
    { fallback: "lg" },
  );
  const router = useRouter();

  useOrgQueryParamSelection();

  const { data: session } = useRequiredSession();

  const bypassProjectGating = isPersonalScope || isOrgScope;
  const workspace = useOrganizationTeamProject({
    redirectToOnboarding: !bypassProjectGating,
    redirectToProjectOnboarding: !bypassProjectGating,
  });
  const publicEnv = usePublicEnv();
  const langyDockInset = useLangyDockInset();

  useShellIdentity({
    session,
    organization: workspace.organization,
    hasPermission: workspace.hasPermission,
  });

  const { isLoading, team, project } = workspace;

  if (typeof router.query.project === "string" && !isLoading && !project) {
    return { status: "not-found" };
  }

  const route = resolveShellRoute({
    pathname: router.pathname,
    isPersonalScope,
    isOrgScope,
    isOnOwnPersonalProject:
      !!team?.isPersonal && team.ownerUserId === session?.user?.id,
  });

  if (!session || isShellDataPending({ workspace, route })) {
    return { status: "loading" };
  }

  return toReadyState({
    user: session.user,
    project,
    route,
    pathname: router.pathname,
    isDevelopment: publicEnv.data?.NODE_ENV === "development",
    isCompactSidebar: isSmallScreen === true,
    langyDockInset,
  });
}

/** Everything the shell draws, assembled once the data is ready. */
function toReadyState({
  user,
  project,
  route,
  pathname,
  isDevelopment,
  isCompactSidebar,
  langyDockInset,
}: {
  user: SessionUser;
  project: OrganizationTeamProject["project"];
  route: ShellRoute;
  pathname: string;
  isDevelopment: boolean;
  isCompactSidebar: boolean;
  langyDockInset: number;
}): NavigationV2ShellReadyState {
  return {
    status: "ready",
    user,
    project,
    currentRoute: findCurrentRoute(pathname),
    activeProductId: route.activeProductId,
    isSettingsRoute: route.isSettingsRoute,
    isDevelopment,
    isCompactSidebar,
    menuWidth: isCompactSidebar
      ? SHELL_SIDEBAR_WIDTH_COMPACT
      : SHELL_SIDEBAR_WIDTH_EXPANDED,
    showPresenceMenuItem: pathname.startsWith("/[project]/traces"),
    langyDockInset,
  };
}

/** Reports the user and their plan to analytics. */
function useShellIdentity({
  session,
  organization,
  hasPermission,
}: {
  session: AppSession;
  organization: OrganizationTeamProject["organization"];
  hasPermission: OrganizationTeamProject["hasPermission"];
}): void {
  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization && hasPermission("organization:view"),
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  );

  usePostHogIdentify({
    session: session ?? null,
    organization,
    planType: usage.data?.activePlan?.type,
  });
}

/**
 * Same dock handshake as the legacy shell: claim the dock so the
 * page-level wrapper stands down, and reserve the docked Langy panel's
 * room inside the content row only.
 */
function useLangyDockInset(): number {
  const langyDockShifted = useLangyStore((s) => s.dockShifted);
  const claimDockShell = useLangyStore((s) => s.claimDockShell);
  const releaseDockShell = useLangyStore((s) => s.releaseDockShell);
  useLayoutEffect(() => {
    claimDockShell();
    return releaseDockShell;
  }, [claimDockShell, releaseDockShell]);

  return langyDockShifted ? LANGY_DOCKED_OFFSET + LANGY_DOCK_GAP : 0;
}

/**
 * Whether the chrome still misses data it needs to draw. A personal
 * scope route needs no organization, and an organization scope route
 * needs no project, so each scope waits only for its own parts.
 */
function isShellDataPending({
  workspace,
  route,
}: {
  workspace: OrganizationTeamProject;
  route: ShellRoute;
}): boolean {
  const { isLoading, organization, organizations, team, project } = workspace;
  if (isLoading) return true;
  if (!route.isPersonalScopeRoute && !(organization && organizations)) {
    return true;
  }
  if (route.isPersonalScopeRoute || route.isOrgScopeRoute) return false;
  if (organization?.primaryIntent) return false;
  return !team || !project;
}
