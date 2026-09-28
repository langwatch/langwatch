/**
 * Workflow's answer to the port its screens, and experiment's, declare: every
 * method projects a `@langwatch/browser-host` capability, so the module
 * mounts it, not the application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import type { UiScopeHost } from "@langwatch/browser-host/use-organization-team-project";
import {
  WorkflowHostApi,
  WorkflowHostProvider,
  type WorkflowCopyTarget,
  type WorkflowFailureNotice,
  type WorkflowRouteReading,
  type WorkflowScope,
  type WorkflowSuccessNotice,
} from "@langwatch/workflow-browser-kit";
import { useMemo, type ReactNode } from "react";

class CapabilityWorkflowHost extends WorkflowHostApi {
  private readonly scopeHost: UiScopeHost | undefined;
  private readonly session: UiSession;
  private readonly uiRoute: UiRoute;
  private readonly navigation: UiNavigation;
  private readonly feedback: UiFeedback;

  constructor({
    scopeHost,
    session,
    uiRoute,
    navigation,
    feedback,
  }: {
    scopeHost: UiScopeHost | undefined;
    session: UiSession;
    uiRoute: UiRoute;
    navigation: UiNavigation;
    feedback: UiFeedback;
  }) {
    super();
    this.scopeHost = scopeHost;
    this.session = session;
    this.uiRoute = uiRoute;
    this.navigation = navigation;
    this.feedback = feedback;
  }

  scope(): WorkflowScope {
    const project = this.scopeHost?.project();
    return {
      projectId: project?.id,
      projectSlug: project?.slug,
      projectName: project?.name,
      organizationId: this.scopeHost?.organization()?.id,
      teamId: this.scopeHost?.team()?.id,
      isResolved: this.scopeHost ? !this.scopeHost.isLoading() : false,
    };
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  /** No org-graph capability exists yet; `[]` is the honest reading (§10.1). */
  copyTargets(): readonly WorkflowCopyTarget[] {
    return [];
  }

  route(): WorkflowRouteReading {
    const { params, query, pathname } = this.uiRoute.reading();
    return pathname === void 0 ? { params, query } : { params, query, pathname };
  }

  /** MERGES into the query, unlike the capability's own REPLACE semantics. */
  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.uiRoute.setQuery({ ...this.uiRoute.reading().query, ...next }, options);
  }

  navigate(to: string): void {
    this.navigation.navigate(to);
  }

  back(): void {
    this.navigation.back();
  }

  succeeded(notice: WorkflowSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: WorkflowFailureNotice): void {
    this.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function WorkflowHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const scopeHost = useUiScope().scopeHost();

  const host = useMemo(
    () => new CapabilityWorkflowHost({ scopeHost, session, uiRoute: route, navigation, feedback }),
    [scopeHost, session, route, navigation, feedback],
  );

  return <WorkflowHostProvider value={host}>{children}</WorkflowHostProvider>;
}
