/**
 * Gateway's answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability. Missing capabilities (org graph,
 * plan, deployment addresses) read honestly empty. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiDeployment,
  useUiScope,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import type { UiScopeHost } from "@langwatch/browser-host/use-organization-team-project";
import { useMemo, type ReactNode } from "react";

import {
  GatewayHostApi,
  GatewayHostProvider,
  type GatewayActor,
  type GatewayDeployment,
  type GatewayDrawer,
  type GatewayFailureNotice,
  type GatewayOrganization,
  type GatewayPlan,
  type GatewayProject,
  type GatewayRouteReading,
  type GatewayScope,
  type GatewaySuccessNotice,
  type GatewayTeam,
} from "../model/gateway-host.ts";
import { gatewayApi, type GatewayOrganizationGraph } from "./gateway-api.ts";

/** Writes a registered drawer's address, clearing every stale `drawer.*` key. */
function openDrawerAddress({
  drawer,
  params,
  route,
}: {
  drawer: string;
  params?: Readonly<Record<string, string | undefined>>;
  route: UiRoute;
}): void {
  const next: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(route.reading().query)) {
    next[key] = key.startsWith("drawer.") ? void 0 : value;
  }
  next["drawer.open"] = drawer;
  for (const [key, value] of Object.entries(params ?? {})) next[`drawer.${key}`] = value;
  route.setQuery(next);
}

/** A stable reference, so a query still loading never re-triggers a memo below it. */
const NO_ORGANIZATIONS: readonly GatewayOrganizationGraph[] = [];

/**
 * The graph in the port's shape: every project carries the team it belongs to,
 * which the graph states by nesting rather than by field.
 */
function organizationsOf(
  graph: readonly GatewayOrganizationGraph[],
): readonly GatewayOrganization[] {
  return graph.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    teams: row.teams.map((team) => ({
      id: team.id,
      name: team.name,
      projects: team.projects.map((project) => ({ ...project, teamId: team.id })),
    })),
  }));
}

class CapabilityGatewayHost extends GatewayHostApi {
  constructor(
    private readonly activeScope: GatewayScope,
    private readonly scopeHost: UiScopeHost | undefined,
    private readonly isSaas: boolean,
    private readonly session: UiSession,
    private readonly navigation: UiNavigation,
    private readonly uiRoute: UiRoute,
    private readonly feedback: UiFeedback,
    private readonly organizations_: readonly GatewayOrganization[],
  ) {
    super();
  }

  scope(): GatewayScope {
    return this.activeScope;
  }

  organizations(): readonly GatewayOrganization[] {
    return this.organizations_;
  }

  organization(): GatewayOrganization | undefined {
    return this.organizations_.find((one) => one.id === this.activeScope.organizationId);
  }

  project(): GatewayProject | undefined {
    const project = this.scopeHost?.project();
    const team = this.scopeHost?.team();
    if (!project || !team) return void 0;
    return { id: project.id, name: project.name, slug: project.slug, teamId: team.id };
  }

  team(): GatewayTeam | undefined {
    const teamId = this.scopeHost?.team()?.id;
    if (teamId === void 0) return void 0;
    return this.organization()?.teams.find((candidate) => candidate.id === teamId);
  }

  currentUser(): GatewayActor | null {
    const actor = this.session.currentUser();
    return actor ? { id: actor.id, name: actor.name, email: actor.email } : null;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  isFeatureEnabled(flag: string): boolean {
    return this.session.isFeatureEnabled(flag);
  }

  /** No entitlement capability exists yet; recorded gap, see the handoff. */
  plan(): GatewayPlan {
    return { isEnterprise: false, webhookEndpointsEnabled: false, isLoading: false };
  }

  /** No deployment-address capability exists yet; recorded gap, see the handoff. */
  deployment(): GatewayDeployment {
    return { isSaas: this.isSaas, appBaseUrl: "", gatewayBaseUrl: "" };
  }

  route(): GatewayRouteReading {
    const { params, query } = this.uiRoute.reading();
    return { params, query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.uiRoute.setQuery(next, options);
  }

  navigate(to: string): void {
    this.navigation.navigate(to);
  }

  openDrawer(request: {
    drawer: GatewayDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    openDrawerAddress({ drawer: request.drawer, params: request.params, route: this.uiRoute });
  }

  succeeded(notice: GatewaySuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: GatewayFailureNotice): void {
    this.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function GatewayHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const { organizationId, projectId } = useUiScope().activeScope();
  const scopeHost = useUiScope().scopeHost();
  const { isSaaS } = useUiDeployment();

  // Shares the tRPC cache entry with every other reader of this procedure, so
  // the graph is fetched once per page however many hosts want it.
  const graph = gatewayApi.organization.getAll.useQuery({ isDemo: false });
  const organizations = useMemo(
    () => organizationsOf(graph.data ?? NO_ORGANIZATIONS),
    [graph.data],
  );

  const host = useMemo(
    () =>
      new CapabilityGatewayHost(
        { organizationId, projectId },
        scopeHost,
        isSaaS,
        session,
        navigation,
        route,
        feedback,
        organizations,
      ),
    [
      organizationId,
      projectId,
      scopeHost,
      isSaaS,
      session,
      navigation,
      route,
      feedback,
      organizations,
    ],
  );

  return <GatewayHostProvider value={host}>{children}</GatewayHostProvider>;
}
