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
import type { ProductId } from "../products";
import { productFromPathname } from "../products";

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
  personalScope,
  orgScope,
}: {
  personalScope: boolean;
  orgScope: boolean;
}): NavigationV2ShellState {
  const isSmallScreen = useBreakpointValue(
    { base: true, lg: false },
    { fallback: "lg" },
  );
  const router = useRouter();

  useOrgQueryParamSelection();

  const { data: session } = useRequiredSession();

  const bypassProjectGating = personalScope || orgScope;
  const {
    isLoading,
    organization,
    organizations,
    team,
    project,
    hasPermission,
  } = useOrganizationTeamProject({
    redirectToOnboarding: !bypassProjectGating,
    redirectToProjectOnboarding: !bypassProjectGating,
  });
  const publicEnv = usePublicEnv();
  const langyDockInset = useLangyDockInset();

  useShellIdentity({ session, organization, hasPermission });

  if (typeof router.query.project === "string" && !isLoading && !project) {
    return { status: "not-found" };
  }

  const route = resolveShellRoute({
    pathname: router.pathname,
    personalScope,
    orgScope,
    isOnOwnPersonalProject:
      !!team?.isPersonal && team.ownerUserId === session?.user?.id,
  });

  if (
    !session ||
    isShellDataPending({
      isLoading,
      hasOrganizations: !!organization && !!organizations,
      hasPrimaryIntent: !!organization?.primaryIntent,
      hasTeamAndProject: !!team && !!project,
      route,
    })
  ) {
    return { status: "loading" };
  }

  return {
    status: "ready",
    user: session.user,
    project,
    currentRoute: findCurrentRoute(router.pathname),
    activeProductId: route.activeProductId,
    isSettingsRoute: route.isSettingsRoute,
    isDevelopment: publicEnv.data?.NODE_ENV === "development",
    isCompactSidebar: isSmallScreen === true,
    showPresenceMenuItem: router.pathname.startsWith("/[project]/traces"),
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
  isLoading,
  hasOrganizations,
  hasPrimaryIntent,
  hasTeamAndProject,
  route,
}: {
  isLoading: boolean;
  hasOrganizations: boolean;
  hasPrimaryIntent: boolean;
  hasTeamAndProject: boolean;
  route: ShellRoute;
}): boolean {
  if (isLoading) return true;
  if (!route.isPersonalScopeRoute && !hasOrganizations) return true;
  if (route.isPersonalScopeRoute || route.isOrgScopeRoute) return false;
  if (hasPrimaryIntent) return false;
  return !hasTeamAndProject;
}

interface ShellRoute {
  isSettingsRoute: boolean;
  isPersonalScopeRoute: boolean;
  isOrgScopeRoute: boolean;
  activeProductId: ProductId | null;
}

/**
 * Which product the address belongs to, and which scope its top bar
 * carries. Settings is not a product: no active product, a static title
 * in the top bar, and the settings sidebar surface.
 */
function resolveShellRoute({
  pathname,
  personalScope,
  orgScope,
  isOnOwnPersonalProject,
}: {
  pathname: string;
  personalScope: boolean;
  orgScope: boolean;
  isOnOwnPersonalProject: boolean;
}): ShellRoute {
  const isSettingsRoute = pathname.startsWith("/settings");
  const isPersonalScopeRoute =
    !isSettingsRoute &&
    (personalScope || pathname.startsWith("/me") || isOnOwnPersonalProject);
  const activeProductId = isSettingsRoute
    ? null
    : ((isPersonalScopeRoute ? "me" : productFromPathname(pathname)) ??
      "llm-ops");
  const isOrgScopeRoute =
    orgScope ||
    isSettingsRoute ||
    activeProductId === "gateway" ||
    activeProductId === "governance";

  return {
    isSettingsRoute,
    isPersonalScopeRoute,
    isOrgScopeRoute,
    activeProductId,
  };
}
