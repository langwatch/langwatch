/**
 * What the AI Gateway screens are mounted inside.
 *
 * Two things go around every `/gateway/*` page: the tRPC Provider the package's
 * own hooks run on, and the host port that answers for the session, the
 * organization graph, the plan, the deployment, the address and the feedback.
 * Both are mounted here, once, so a screen module stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping:
 * the adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it.
 */

import { gatewayApi, GatewayHostProvider } from "@langwatch/gateway-web/screens/gateway";
import { useMemo, type ComponentType, type ReactNode } from "react";
import type { GatewayOrganization } from "@langwatch/gateway-web/screens/gateway";
import { readPublicAppConfig } from "../../../../behavior/public-config";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiGatewayHost } from "../../behavior/gateway-host.adapter";

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

function GatewayHost({ children }: { children: ReactNode }) {
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
  const host = useMemo(
    () =>
      UiGatewayHost.create(
        {
          scope,
          organizations: organizationsWithTeamIds,
          currentUser: actor ? { id: actor.id, name: actor.name, email: actor.email } : null,
          plan: {
            isEnterprise: usage.data?.activePlan.type === "ENTERPRISE",
            // Absent means the plan row predates the entitlement, which is not
            // the same as a plan that carries it and says no.
            webhookEndpointsEnabled: usage.data?.activePlan.webhookEndpointsEnabled === true,
            isLoading: usage.isLoading,
          },
          deployment: readDeployment(),
          route: reading,
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          isFeatureEnabled: (flag) => session.isFeatureEnabled(flag),
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to) => navigation.navigate(to),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
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

/** Wraps one gateway screen in the host its package asks for. */
export function withGatewayHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <GatewayHost>
      <Screen {...props} />
    </GatewayHost>
  );
  Mounted.displayName = `withGatewayHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
