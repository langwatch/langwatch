/**
 * What the AI Gateway screens are mounted inside: the tRPC Provider their
 * hooks run on, and the host port for session, org graph, plan, deployment,
 * address and feedback.
 */

import {
  gatewayApi,
  GatewayHostProvider,
  type GatewayHostPort,
  type GatewayOrganization,
} from "@langwatch/gateway-web/screens/gateway";
import { useMemo, type ReactNode } from "react";
import { DRAWER_OPEN_PARAM } from "../../../../model/ui-drawer-address";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useUiShellFailure } from "../../../../behavior/ui-shell-failure";
import { UiPageFailure, UiPageLoading } from "../../../../ui/sections/ui-page-fallbacks";
import { openGatewayDrawer } from "../../behavior/gateway-open-drawer";
import {
  resolveGatewayOrganization,
  resolveGatewayProject,
  resolveGatewayTeam,
} from "../../behavior/gateway-scope-lookup";

/**
 * The deployment shape, read once. No config means a self-hosted deployment
 * with none stated, not a broken one — the usage snippet falls back to the
 * hosted gateway's address.
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

/** The `organization.getAll` row shape, restated locally since the screen package's public boundary does not export it. */
type GatewayOrganizationGraphEntry = {
  id: string;
  name: string;
  slug: string;
  teams: { id: string; name: string; projects: { id: string; name: string; slug: string }[] }[];
};

/** Stamps every project in one organization's teams with its team's id. */
function withTeamProjectIds(organization: GatewayOrganizationGraphEntry): GatewayOrganization {
  return {
    ...organization,
    teams: organization.teams.map((team) => ({
      ...team,
      projects: team.projects.map((project) => ({ ...project, teamId: team.id })),
    })),
  };
}

export function GatewayHost({ children }: { children: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = session.activeScope();
  const organizationId = scope.organizationId;
  const actor = session.currentUser();

  const organizations = gatewayApi.organization.getAll.useQuery({ isDemo: false });

  // A refused graph is a state, not an empty one: every scope answer below is
  // read off this query, so a refusal left the gateway screens empty forever.
  const failure = useUiShellFailure({
    error: organizations.error,
    fallbackTitle: "Couldn't load your AI gateway",
  });

  const usage = gatewayApi.limits.getUsage.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && session.hasPermission("organization:view"), retry: false },
  );

  /** The graph, with each project stamped with its team id — the screens read a flat project and need it. */
  const organizationsWithTeamIds: readonly GatewayOrganization[] = useMemo(
    () => (organizations.data ?? []).map((organization) => withTeamProjectIds(organization)),
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

  if (failure.departing) return <UiPageLoading />;
  if (failure.copy) return <UiPageFailure copy={failure.copy} />;

  return <GatewayHostProvider value={host}>{children}</GatewayHostProvider>;
}
