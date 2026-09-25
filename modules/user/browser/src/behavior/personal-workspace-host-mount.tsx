/**
 * Personal workspace's answer to the port its screens declare: every method
 * projects a `@langwatch/browser-host` capability, so the module mounts it,
 * not the application. ARCHITECTURE.md §10.1.
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
import { useMemo, type ReactNode } from "react";

import {
  PersonalWorkspaceHostApi,
  PersonalWorkspaceHostProvider,
  type HeldPasskey,
  type LinkSignInMethodOutcome,
  type PasskeyOutcome,
  type PersonalActor,
  type PersonalDeployment,
  type PersonalFailureNotice,
  type PersonalOrganization,
  type PersonalOrganizationRole,
  type PersonalProject,
  type PersonalRouteReading,
  type PersonalScope,
  type PersonalSuccessNotice,
} from "../model/personal-workspace-host.ts";
import { personalWorkspaceApi, type PersonalOrganizationGraph } from "./personal-workspace-api.ts";

/** A stable reference, so a query still loading never re-triggers a memo below it. */
const NO_ORGANIZATIONS: readonly PersonalOrganizationGraph[] = [];

/**
 * The organization in scope, in the port's shape: every project carries the
 * team it belongs to, which the graph states by nesting rather than by field.
 */
function organizationOf(
  graph: readonly PersonalOrganizationGraph[],
  organizationId: string | null,
): PersonalOrganization | undefined {
  if (organizationId === null) return void 0;
  const row = graph.find((candidate) => candidate.id === organizationId);
  if (!row) return void 0;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ssoProvider: row.ssoProvider,
    teams: row.teams.map((team) => ({
      id: team.id,
      name: team.name,
      projects: team.projects.map((project) => ({ ...project, teamId: team.id })),
    })),
  };
}

/** The project in scope, found wherever in the graph it sits. */
function projectOf(
  graph: readonly PersonalOrganizationGraph[],
  projectId: string | null,
): PersonalProject | undefined {
  if (projectId === null) return void 0;
  for (const row of graph) {
    for (const team of row.teams) {
      const found = team.projects.find((candidate) => candidate.id === projectId);
      if (found) return { ...found, teamId: team.id };
    }
  }
  return void 0;
}

class CapabilityPersonalWorkspaceHost extends PersonalWorkspaceHostApi {
  private readonly session: UiSession;
  private readonly navigationCapability: UiNavigation;
  private readonly routeCapability: UiRoute;
  private readonly feedback: UiFeedback;
  private readonly scope_: PersonalScope;
  private readonly organizationRole_: PersonalOrganizationRole;
  private readonly deployment_: PersonalDeployment;
  private readonly organization_: PersonalOrganization | undefined;
  private readonly project_: PersonalProject | undefined;

  constructor({
    session,
    navigationCapability,
    routeCapability,
    feedback,
    scope,
    organizationRole,
    deployment,
    organization,
    project,
  }: {
    session: UiSession;
    navigationCapability: UiNavigation;
    routeCapability: UiRoute;
    feedback: UiFeedback;
    scope: PersonalScope;
    organizationRole: PersonalOrganizationRole;
    deployment: PersonalDeployment;
    organization: PersonalOrganization | undefined;
    project: PersonalProject | undefined;
  }) {
    super();
    this.session = session;
    this.navigationCapability = navigationCapability;
    this.routeCapability = routeCapability;
    this.feedback = feedback;
    this.scope_ = scope;
    this.organizationRole_ = organizationRole;
    this.deployment_ = deployment;
    this.organization_ = organization;
    this.project_ = project;
  }

  scope(): PersonalScope {
    return this.scope_;
  }

  organization(): PersonalOrganization | undefined {
    return this.organization_;
  }

  project(): PersonalProject | undefined {
    return this.project_;
  }

  isScopeResolved(): boolean {
    return this.session.snapshot().scope.status !== "loading";
  }

  currentUser(): PersonalActor | null {
    return this.session.currentUser();
  }

  organizationRole(): PersonalOrganizationRole {
    return this.organizationRole_;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  isFeatureEnabled(flag: string): boolean {
    return this.session.isFeatureEnabled(flag);
  }

  deployment(): PersonalDeployment {
    return this.deployment_;
  }

  route(): PersonalRouteReading {
    const reading = this.routeCapability.reading();
    return { params: reading.params, query: reading.query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.routeCapability.setQuery(next, options);
  }

  navigate(to: string): void {
    this.navigationCapability.navigate(to);
  }

  /** No session-refresh capability exists; the honest reading does nothing. */
  async refreshSession(): Promise<void> {
    return void 0;
  }

  /** No passkey ceremony capability exists; empty is the honest reading. */
  async listPasskeys(): Promise<readonly HeldPasskey[]> {
    return [];
  }

  async registerPasskey(): Promise<PasskeyOutcome> {
    return { ok: false, cancelled: false };
  }

  async renamePasskey(): Promise<PasskeyOutcome> {
    return { ok: false, cancelled: false };
  }

  async removePasskey(): Promise<PasskeyOutcome> {
    return { ok: false, cancelled: false };
  }

  async linkSignInMethod(): Promise<LinkSignInMethodOutcome> {
    return { ok: false, reason: "Linking a sign-in method is not available here." };
  }

  /** No assistant hand-off capability exists; false/no-op is the honest reading. */
  canAskAssistant(): boolean {
    return false;
  }

  askAssistant(): void {
    return void 0;
  }

  succeeded(notice: PersonalSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: PersonalFailureNotice): void {
    this.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because
 * that is what `mounts.load` resolves.
 */
export default function PersonalWorkspaceHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scope = useUiScope();
  const activeScope = scope.activeScope();
  const organizationRole = scope.scopeHost()?.organizationRole();
  const deployment = useUiDeployment();

  // Shares the tRPC cache entry with every other reader of this procedure, so
  // the graph is fetched once per page however many hosts want it.
  const organizations = personalWorkspaceApi.organization.getAll.useQuery({ isDemo: false });
  const graph = organizations.data ?? NO_ORGANIZATIONS;

  const organization = useMemo(
    () => organizationOf(graph, activeScope.organizationId),
    [graph, activeScope.organizationId],
  );
  const project = useMemo(
    () => projectOf(graph, activeScope.projectId),
    [graph, activeScope.projectId],
  );

  // Primitive dependencies only, so the host stays the SAME object across
  // renders that carry the same reading.
  const host = useMemo(
    () =>
      new CapabilityPersonalWorkspaceHost({
        session,
        navigationCapability: navigation,
        routeCapability: route,
        feedback,
        scope: { organizationId: activeScope.organizationId, projectId: activeScope.projectId },
        organizationRole,
        deployment: {
          isSaas: deployment.isSaaS,
          appBaseUrl: deployment.appBaseUrl,
          passkeysEnabled: deployment.passkeysEnabled ?? false,
          authProvider: deployment.authProvider,
          // No capability carries this yet: main's EMAIL_PASSWORD_ENABLED is not ported.
          emailPasswordEnabled: false,
        },
        organization,
        project,
      }),
    [
      session,
      navigation,
      route,
      feedback,
      activeScope.organizationId,
      activeScope.projectId,
      organizationRole,
      deployment.isSaaS,
      deployment.appBaseUrl,
      deployment.passkeysEnabled,
      deployment.authProvider,
      organization,
      project,
    ],
  );
  return <PersonalWorkspaceHostProvider value={host}>{children}</PersonalWorkspaceHostProvider>;
}
