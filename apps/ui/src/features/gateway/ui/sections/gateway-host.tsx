/**
 * What the AI Gateway screens are mounted inside.
 *
 * Two things go around every `/gateway/*` page: the tRPC Provider the package's
 * own hooks run on, and the host port that answers for the session, the
 * organization graph, the plan, the deployment, the address and the feedback.
 * Both are mounted here, once, so a screen module stays a screen module.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it.
 */

import {
  gatewayApi,
  GatewayHostProvider,
  type GatewayHostPort,
  type GatewayOrganization,
} from "@langwatch/gateway-web/screens/gateway";
import { useMemo, type ReactNode } from "react";
import { DRAWER_OPEN_PARAM } from "../../../drawers";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { openGatewayDrawer } from "../../behavior/gateway-open-drawer";
import {
  resolveGatewayOrganization,
  resolveGatewayProject,
  resolveGatewayTeam,
} from "../../behavior/gateway-scope-lookup";

/**
 * The deployment shape, read once.
 *
 * A composition whose HTML shell carries no configuration is a self-hosted one
 * with no stated addresses rather than a broken one: the usage snippet then
 * prints the hosted gateway, which is what `resolveSnippetGatewayBaseUrl` falls
 * back to on its own.
 */
function readDeployment(): { isSaas: boolean; appBaseUrl: string; gatewayBaseUrl: string } {
  try {
    const config = readPublicAppConfig();
    return {
      isSaas: config.deployment === "saas",
      appBaseUrl: config.appBaseUrl,
      gatewayBaseUrl: config.gatewayBaseUrl,
    };
  } catch {
    return {
      isSaas: false,
      appBaseUrl: "https://app.langwatch.ai",
      gatewayBaseUrl: "",
    };
  }
}

export function GatewayHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const organizationId = scope.organizationId;
  const actor = session.currentUser();

  const organizations = gatewayApi.organization.getAll.useQuery({ isDemo: false });
  const usage = gatewayApi.limits.getUsage.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && session.hasPermission("organization:view"), retry: false },
  );

  /**
   * The graph, with each project told which team it belongs to.
   *
   * `organization.getAll` nests projects under teams and so never repeats the
   * team id on a project row; the screens read a flat project and need it, so
   * it is stamped on here rather than asked for a second time.
   */
  const organizationsWithTeamIds: readonly GatewayOrganization[] = useMemo(
    () =>
      (organizations.data ?? []).map((organization) => ({
        ...organization,
        teams: organization.teams.map((team) => ({
          ...team,
          projects: team.projects.map((project) => ({ ...project, teamId: team.id })),
        })),
      })),
    [organizations.data],
  );

  const reading = route.reading();

  const host = useMemo<GatewayHostPort>(
    () => ({
      scope: () => scope,
      organizations: () => organizationsWithTeamIds,
      organization: () =>
        resolveGatewayOrganization({
          organizations: organizationsWithTeamIds,
          organizationId: scope.organizationId,
        }),
      project: () =>
        resolveGatewayProject({
          organizations: organizationsWithTeamIds,
          projectId: scope.projectId,
        }),
      team: () =>
        resolveGatewayTeam({ organizations: organizationsWithTeamIds, projectId: scope.projectId }),
      currentUser: () => (actor ? { id: actor.id, name: actor.name, email: actor.email } : null),
      hasPermission: (permission) => session.hasPermission(permission),
      isFeatureEnabled: (flag) => session.isFeatureEnabled(flag),
      plan: () => ({
        isEnterprise: usage.data?.activePlan.type === "ENTERPRISE",
        // Absent means the plan row predates the entitlement, which is not
        // the same as a plan that carries it and says no.
        webhookEndpointsEnabled: usage.data?.activePlan.webhookEndpointsEnabled === true,
        isLoading: usage.isLoading,
      }),
      deployment: () => readDeployment(),
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      navigate: (to) => navigation.navigate(to),
      openDrawer: ({ drawer, params }) =>
        openGatewayDrawer({
          drawer,
          params,
          query: reading.query,
          drawerOpenParam: DRAWER_OPEN_PARAM,
          setQuery: (next) => route.setQuery(next),
        }),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [
      scope,
      actor,
      organizationsWithTeamIds,
      usage.data,
      usage.isLoading,
      reading,
      session,
      route,
      navigation,
      feedback,
    ],
  );

  return <GatewayHostProvider value={host}>{children}</GatewayHostProvider>;
}
