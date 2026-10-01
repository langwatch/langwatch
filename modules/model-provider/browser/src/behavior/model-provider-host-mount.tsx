/**
 * Model Provider's answer to the port its screens declare: every method
 * projects a `@langwatch/browser-host` capability. `availableScopes` reads
 * the caller's reach from `organization.getScopeGraph`, as main did. §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import type { UiScopeHost } from "@langwatch/browser-host/use-organization-team-project";
import { useMemo, type ReactNode } from "react";

import {
  ModelProviderHostApi,
  ModelProviderHostProvider,
  type ModelProviderAvailableScopes,
  type ModelProviderFailureNotice,
  type ModelProviderHostScope,
  type ModelProviderPlatformDrawer,
  type ModelProviderRouteReading,
  type ModelProviderSuccessNotice,
} from "../model/model-provider-host.ts";
import {
  modelProviderApi,
  type ModelProviderScopeGraphOrganization,
} from "./model-provider-api.ts";

const NO_ORGANIZATIONS: ModelProviderScopeGraphOrganization[] = [];

/** The active organization's teams and projects; null when the graph has no such organization. */
export function scopesFromGraph({
  organizations,
  organizationId,
}: {
  organizations: readonly ModelProviderScopeGraphOrganization[];
  organizationId: string | undefined;
}): ModelProviderAvailableScopes | null {
  const organization = organizations.find((candidate) => candidate.id === organizationId);
  if (!organization) return null;
  return {
    organization: { id: organization.id, name: organization.name },
    teams: organization.teams.map((team) => ({ id: team.id, name: team.name })),
    projects: organization.teams.flatMap((team) =>
      team.projects.map((project) => ({
        id: project.id,
        name: `${project.name} · ${team.name}`,
        teamId: team.id,
      })),
    ),
  };
}

/** Writes a `platform/app` drawer's address, clearing stale `drawer.*` keys. */
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

class CapabilityModelProviderHost extends ModelProviderHostApi {
  private readonly hostScope: ModelProviderHostScope;
  private readonly scopeHost: UiScopeHost | undefined;
  private readonly session: UiSession;
  private readonly uiRoute: UiRoute;
  private readonly feedback: UiFeedback;
  private readonly organizations: readonly ModelProviderScopeGraphOrganization[];

  constructor({
    hostScope,
    scopeHost,
    session,
    uiRoute,
    feedback,
    organizations,
  }: {
    hostScope: ModelProviderHostScope;
    scopeHost: UiScopeHost | undefined;
    session: UiSession;
    uiRoute: UiRoute;
    feedback: UiFeedback;
    organizations: readonly ModelProviderScopeGraphOrganization[];
  }) {
    super();
    this.organizations = organizations;
    this.hostScope = hostScope;
    this.scopeHost = scopeHost;
    this.session = session;
    this.uiRoute = uiRoute;
    this.feedback = feedback;
  }

  scope(): ModelProviderHostScope {
    return this.hostScope;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  /** The caller's teams and projects; the current scope alone until the graph loads. */
  availableScopes(): ModelProviderAvailableScopes {
    const reach = scopesFromGraph({
      organizations: this.organizations,
      organizationId: this.hostScope.organizationId,
    });
    if (reach) return reach;
    const organization = this.scopeHost?.organization();
    const team = this.scopeHost?.team();
    const project = this.scopeHost?.project();
    return {
      organization: organization ? { id: organization.id, name: organization.name ?? "" } : null,
      teams: team ? [{ id: team.id, name: team.name ?? "" }] : [],
      projects: project ? [{ id: project.id, name: project.name, teamId: team?.id }] : [],
    };
  }

  route(): ModelProviderRouteReading {
    const { params, query } = this.uiRoute.reading();
    return { params, query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.uiRoute.setQuery(next, options);
  }

  succeeded(notice: ModelProviderSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: ModelProviderFailureNotice): void {
    this.feedback.failed(failure);
  }

  /** Recorded gap: the dedup `WeakSet` lives on a MutationCache this build doesn't wrap. */
  isReportedGlobally(): boolean {
    return false;
  }

  openPlatformDrawer(request: {
    drawer: ModelProviderPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    openDrawerAddress({ drawer: request.drawer, params: request.params, route: this.uiRoute });
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function ModelProviderHostMount({ children }: { children?: ReactNode }) {
  const { session, route, feedback } = useUiCapabilities();
  const { organizationId, projectId } = useUiScope().activeScope();
  const scopeHost = useUiScope().scopeHost();

  const hostScope = useMemo<ModelProviderHostScope>(
    () => ({
      organizationId: organizationId ?? undefined,
      teamId: scopeHost?.team()?.id,
      projectId: projectId ?? undefined,
      projectSlug: scopeHost?.project()?.slug,
    }),
    [organizationId, projectId, scopeHost],
  );

  const graph = modelProviderApi.organization.getScopeGraph.useQuery(
    {},
    { enabled: !!session.currentUser() },
  );
  const organizations = graph.data ?? NO_ORGANIZATIONS;

  const host = useMemo(
    () =>
      new CapabilityModelProviderHost({
        hostScope,
        scopeHost,
        session,
        uiRoute: route,
        feedback,
        organizations,
      }),
    [hostScope, scopeHost, session, route, feedback, organizations],
  );

  return <ModelProviderHostProvider value={host}>{children}</ModelProviderHostProvider>;
}
