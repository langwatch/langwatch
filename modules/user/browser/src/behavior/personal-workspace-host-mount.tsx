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

class CapabilityPersonalWorkspaceHost extends PersonalWorkspaceHostApi {
  constructor(
    private readonly session: UiSession,
    private readonly navigationCapability: UiNavigation,
    private readonly routeCapability: UiRoute,
    private readonly feedback: UiFeedback,
    private readonly scope_: PersonalScope,
    private readonly organizationRole_: PersonalOrganizationRole,
    private readonly deployment_: PersonalDeployment,
  ) {
    super();
  }

  scope(): PersonalScope {
    return this.scope_;
  }

  /**
   * The rich organization row (SSO provider, every team) is not a
   * browser-host capability — undefined is the honest reading.
   */
  organization(): PersonalOrganization | undefined {
    return void 0;
  }

  /** No team-id capability exists alongside the project reading — undefined is honest. */
  project(): PersonalProject | undefined {
    return void 0;
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

  // Primitive dependencies only, so the host stays the SAME object across
  // renders that carry the same reading.
  const host = useMemo(
    () =>
      new CapabilityPersonalWorkspaceHost(
        session,
        navigation,
        route,
        feedback,
        { organizationId: activeScope.organizationId, projectId: activeScope.projectId },
        organizationRole,
        {
          isSaas: deployment.isSaaS,
          // No capability carries these three yet — see the handoff for the
          // widening this host is waiting on.
          appBaseUrl: "",
          passkeysEnabled: false,
          authProvider: void 0,
        },
      ),
    [
      session,
      navigation,
      route,
      feedback,
      activeScope.organizationId,
      activeScope.projectId,
      organizationRole,
      deployment.isSaaS,
    ],
  );
  return <PersonalWorkspaceHostProvider value={host}>{children}</PersonalWorkspaceHostProvider>;
}
