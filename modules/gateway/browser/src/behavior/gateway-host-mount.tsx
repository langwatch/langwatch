/**
 * Gateway's answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability or its own read. ARCHITECTURE.md §10.1.
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

/** The plan as the port states it; a legacy row without the webhook flag reads as off. */
function planOf({
  activePlan,
  isLoading,
}: {
  activePlan: { type: string; webhookEndpointsEnabled?: boolean } | undefined;
  isLoading: boolean;
}): GatewayPlan {
  return {
    isEnterprise: activePlan?.type === "ENTERPRISE",
    webhookEndpointsEnabled: activePlan?.webhookEndpointsEnabled === true,
    isLoading,
  };
}

class CapabilityGatewayHost extends GatewayHostApi {
  private readonly activeScope: GatewayScope;
  private readonly scopeHost: UiScopeHost | undefined;
  private readonly deployment_: GatewayDeployment;
  private readonly session: UiSession;
  private readonly navigation: UiNavigation;
  private readonly uiRoute: UiRoute;
  private readonly feedback: UiFeedback;
  private readonly organizations_: readonly GatewayOrganization[];
  private readonly plan_: GatewayPlan;

  constructor({
    activeScope,
    scopeHost,
    deployment,
    session,
    navigation,
    uiRoute,
    feedback,
    organizations,
    plan,
  }: {
    activeScope: GatewayScope;
    scopeHost: UiScopeHost | undefined;
    deployment: GatewayDeployment;
    session: UiSession;
    navigation: UiNavigation;
    uiRoute: UiRoute;
    feedback: UiFeedback;
    organizations: readonly GatewayOrganization[];
    plan: GatewayPlan;
  }) {
    super();
    this.activeScope = activeScope;
    this.scopeHost = scopeHost;
    this.deployment_ = deployment;
    this.session = session;
    this.navigation = navigation;
    this.uiRoute = uiRoute;
    this.feedback = feedback;
    this.organizations_ = organizations;
    this.plan_ = plan;
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

  plan(): GatewayPlan {
    return this.plan_;
  }

  deployment(): GatewayDeployment {
    return this.deployment_;
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
  const { isSaaS, appBaseUrl, gatewayBaseUrl } = useUiDeployment();

  // Shares the tRPC cache entry with every other reader of this procedure, so
  // the graph is fetched once per page however many hosts want it.
  const graph = gatewayApi.organization.getAll.useQuery({ isDemo: false });
  const organizations = useMemo(
    () => organizationsOf(graph.data ?? NO_ORGANIZATIONS),
    [graph.data],
  );

  // The plan tier only: the session-cached read, not the monthly usage count.
  const activePlan = gatewayApi.plan.getActivePlan.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && session.hasPermission("organization:view"), retry: false },
  );
  const plan = useMemo(
    () => planOf({ activePlan: activePlan.data, isLoading: activePlan.isLoading }),
    [activePlan.data, activePlan.isLoading],
  );

  const host = useMemo(
    () =>
      new CapabilityGatewayHost({
        activeScope: { organizationId, projectId },
        scopeHost,
        deployment: { isSaas: isSaaS, appBaseUrl, gatewayBaseUrl },
        session,
        navigation,
        uiRoute: route,
        feedback,
        organizations,
        plan,
      }),
    [
      organizationId,
      projectId,
      scopeHost,
      isSaaS,
      appBaseUrl,
      gatewayBaseUrl,
      session,
      navigation,
      route,
      feedback,
      organizations,
      plan,
    ],
  );

  return <GatewayHostProvider value={host}>{children}</GatewayHostProvider>;
}
