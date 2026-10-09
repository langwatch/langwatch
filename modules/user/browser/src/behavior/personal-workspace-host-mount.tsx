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
import { useUiFlags, type UiFlags } from "@langwatch/browser-host/feature-flag";
import { readSlice } from "@langwatch/browser-host/global-store";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import {
  LANGY_ABSENT_SURFACE,
  LANGY_STORE_SLICE,
  type LangySliceSurface,
} from "@langwatch/langy-contract";
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
  type TwoStepAnswer,
  type TwoStepSetup,
} from "../model/personal-workspace-host.ts";
import { useLentAuthCeremonies, type LentAuthCeremonies } from "./lent-auth-ceremonies.ts";
import { personalWorkspaceApi, type PersonalOrganizationGraph } from "./personal-workspace-api.ts";

/** What a two-step ceremony answers where auth lent none. */
const NO_TWO_STEP_CEREMONIES: { ok: false; error: unknown } = {
  ok: false,
  error: new Error("Two-step verification ceremonies are not installed"),
};

/** Starting a Langy turn, not reading one. */
const LANGY_CREATE_PERMISSION = "langy:create";

/** Langy's panel state, read like any peer's slice; Langy owns the writes. */
const useLangyStore = readSlice<LangySliceSurface>({
  name: LANGY_STORE_SLICE,
  absent: LANGY_ABSENT_SURFACE,
});

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
  private readonly flags: UiFlags;
  private readonly navigationCapability: UiNavigation;
  private readonly routeCapability: UiRoute;
  private readonly feedback: UiFeedback;
  private readonly scope_: PersonalScope;
  private readonly organizationRole_: PersonalOrganizationRole;
  private readonly deployment_: PersonalDeployment;
  private readonly organization_: PersonalOrganization | undefined;
  private readonly project_: PersonalProject | undefined;
  private readonly lent: LentAuthCeremonies;
  private readonly askLangy: (prompt: string) => void;

  constructor({
    session,
    flags,
    navigationCapability,
    routeCapability,
    feedback,
    scope,
    organizationRole,
    deployment,
    organization,
    project,
    lent,
    askLangy,
  }: {
    session: UiSession;
    flags: UiFlags;
    navigationCapability: UiNavigation;
    routeCapability: UiRoute;
    feedback: UiFeedback;
    scope: PersonalScope;
    organizationRole: PersonalOrganizationRole;
    deployment: PersonalDeployment;
    organization: PersonalOrganization | undefined;
    project: PersonalProject | undefined;
    lent: LentAuthCeremonies;
    askLangy: (prompt: string) => void;
  }) {
    super();
    this.session = session;
    this.flags = flags;
    this.navigationCapability = navigationCapability;
    this.routeCapability = routeCapability;
    this.feedback = feedback;
    this.scope_ = scope;
    this.organizationRole_ = organizationRole;
    this.deployment_ = deployment;
    this.organization_ = organization;
    this.project_ = project;
    this.lent = lent;
    this.askLangy = askLangy;
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

  /** Re-reads the signed-in reader, so the chrome shows a new name or photo. */
  refreshSession(): Promise<void> {
    return this.session.refresh();
  }

  /** Where auth lent no passkey ceremonies, empty is the honest reading. */
  async listPasskeys(): Promise<readonly HeldPasskey[]> {
    if (!this.lent.passkeys) return [];
    const ceremonies = await this.lent.passkeys();
    return ceremonies.list();
  }

  async registerPasskey(): Promise<PasskeyOutcome> {
    if (!this.lent.passkeys) return { ok: false, cancelled: false };
    const ceremonies = await this.lent.passkeys();
    return ceremonies.register();
  }

  async renamePasskey(input: { id: string; name: string }): Promise<PasskeyOutcome> {
    if (!this.lent.passkeys) return { ok: false, cancelled: false };
    const ceremonies = await this.lent.passkeys();
    return ceremonies.rename(input);
  }

  async removePasskey(input: { id: string }): Promise<PasskeyOutcome> {
    if (!this.lent.passkeys) return { ok: false, cancelled: false };
    const ceremonies = await this.lent.passkeys();
    return ceremonies.remove(input);
  }

  async startTwoStepSetup(input: { password?: string }): Promise<TwoStepAnswer<TwoStepSetup>> {
    if (!this.lent.twoStepVerification) return NO_TWO_STEP_CEREMONIES;
    const ceremonies = await this.lent.twoStepVerification();
    return ceremonies.start(input);
  }

  async confirmTwoStepSetup(input: { code: string }): Promise<TwoStepAnswer<{ confirmed: true }>> {
    if (!this.lent.twoStepVerification) return NO_TWO_STEP_CEREMONIES;
    const ceremonies = await this.lent.twoStepVerification();
    return ceremonies.confirm(input);
  }

  async regenerateBackupCodes(input: {
    password?: string;
  }): Promise<TwoStepAnswer<{ backupCodes: readonly string[] }>> {
    if (!this.lent.twoStepVerification) return NO_TWO_STEP_CEREMONIES;
    const ceremonies = await this.lent.twoStepVerification();
    return ceremonies.regenerateBackupCodes(input);
  }

  async linkSignInMethod(provider: string): Promise<LinkSignInMethodOutcome> {
    if (!this.lent.signInMethodLinking) {
      return { ok: false, reason: "Linking a sign-in method is not available here." };
    }
    const linking = await this.lent.signInMethodLinking();
    return linking.link({ provider });
  }

  /** Main's useCanAskLangy grant, plus the rollout the shell's command bar also asks. */
  canAskAssistant(): boolean {
    return (
      this.session.hasPermission(LANGY_CREATE_PERMISSION) &&
      this.flags.flag(FrontendFlags.release_langy_enabled) === true
    );
  }

  askAssistant(prompt: string): void {
    this.askLangy(prompt);
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
  const flags = useUiFlags();
  const scope = useUiScope();
  const activeScope = scope.activeScope();
  const organizationRole = scope.scopeHost()?.organizationRole();
  const deployment = useUiDeployment();
  const lent = useLentAuthCeremonies();
  const askLangy = useLangyStore((store) => store.askLangy);

  // Shares the tRPC cache entry with every other reader of this procedure, so
  // the graph is fetched once per page however many hosts want it.
  const organizations = personalWorkspaceApi.organization.getScopeGraph.useQuery(
    {},
    { enabled: !!session.currentUser() },
  );
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
        flags,
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
          emailPasswordEnabled: deployment.emailPasswordEnabled ?? false,
        },
        organization,
        project,
        lent,
        askLangy,
      }),
    [
      session,
      flags,
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
      deployment.emailPasswordEnabled,
      organization,
      project,
      lent,
      askLangy,
    ],
  );
  return <PersonalWorkspaceHostProvider value={host}>{children}</PersonalWorkspaceHostProvider>;
}
