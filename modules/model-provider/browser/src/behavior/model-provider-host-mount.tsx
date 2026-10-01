/**
 * Model Provider's answer to the port its screens declare: every method
 * projects a `@langwatch/browser-host` capability. `availableScopes` reads
 * only the current scope; no org-graph capability exists yet. §10.1.
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

  constructor({
    hostScope,
    scopeHost,
    session,
    uiRoute,
    feedback,
  }: {
    hostScope: ModelProviderHostScope;
    scopeHost: UiScopeHost | undefined;
    session: UiSession;
    uiRoute: UiRoute;
    feedback: UiFeedback;
  }) {
    super();
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

  /** Only the current scope, not the reader's full reach: no org-graph capability exists yet. */
  availableScopes(): ModelProviderAvailableScopes {
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

  const host = useMemo(
    () =>
      new CapabilityModelProviderHost({ hostScope, scopeHost, session, uiRoute: route, feedback }),
    [hostScope, scopeHost, session, route, feedback],
  );

  return <ModelProviderHostProvider value={host}>{children}</ModelProviderHostProvider>;
}
