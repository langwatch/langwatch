/**
 * Analytics' answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  AnalyticsHostApi,
  AnalyticsHostProvider,
  type AnalyticsAlertAuthoring,
  type AnalyticsFailureNotice,
  type AnalyticsHostProject,
  type AnalyticsRouteReading,
  type AnalyticsSuccessNotice,
} from "../model/analytics-host.ts";
import { automationDrawerAddress } from "../model/analytics-overlay-address.ts";
import { analyticsApi } from "./analytics-api.ts";

class CapabilityAnalyticsHost extends AnalyticsHostApi {
  private readonly project_: AnalyticsHostProject | undefined;
  private readonly organizationId_: string | undefined;
  private readonly session: UiSession;
  private readonly routeCapability: UiRoute;
  private readonly navigationCapability: UiNavigation;
  private readonly feedback: UiFeedback;

  constructor({
    project_,
    organizationId_,
    session,
    routeCapability,
    navigationCapability,
    feedback,
  }: {
    project_: AnalyticsHostProject | undefined;
    organizationId_: string | undefined;
    session: UiSession;
    routeCapability: UiRoute;
    navigationCapability: UiNavigation;
    feedback: UiFeedback;
  }) {
    super();
    this.project_ = project_;
    this.organizationId_ = organizationId_;
    this.session = session;
    this.routeCapability = routeCapability;
    this.navigationCapability = navigationCapability;
    this.feedback = feedback;
  }

  project(): AnalyticsHostProject | undefined {
    return this.project_;
  }

  organizationId(): string | undefined {
    return this.organizationId_;
  }

  userId(): string | undefined {
    return this.session.currentUser()?.id;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  isSettled(): boolean {
    return this.session.isSettled();
  }

  featureFlag(flag: string): boolean | undefined {
    return this.session.featureFlag(flag);
  }

  route(): AnalyticsRouteReading {
    const reading = this.routeCapability.reading();
    return { params: reading.params, query: reading.query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.routeCapability.setQuery(next, options);
  }

  navigate(to: string, options?: { replace?: boolean }): void {
    if (options?.replace) this.navigationCapability.replace(to);
    else this.navigationCapability.navigate(to);
  }

  openAutomationDrawer(request: AnalyticsAlertAuthoring): void {
    const current = this.routeCapability.reading().query;
    this.routeCapability.setQuery(automationDrawerAddress({ current, ...request }));
  }

  succeeded(notice: AnalyticsSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: AnalyticsFailureNotice): void {
    this.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because
 * that is what `mounts.load` resolves.
 */
export default function AnalyticsHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const { organizationId, projectId } = useUiScope().activeScope();
  const scopeProject = session.snapshot().scope.project;
  const scopeProjectId = scopeProject?.id;
  const scopeProjectSlug = scopeProject?.slug;
  const scopeProjectName = scopeProject?.name;

  const firstMessage = analyticsApi.project.getHasFirstMessage.useQuery(
    { projectId: scopeProjectId ?? "" },
    { enabled: scopeProjectId !== void 0 },
  );
  // Unknown until the project answers: no setup prompt flashes over a project with traces.
  const hasFirstMessage = firstMessage.data?.firstMessage ?? true;

  // Primitive dependencies only, so the host stays the SAME object across
  // renders that carry the same reading.
  const host = useMemo(
    () =>
      new CapabilityAnalyticsHost({
        project_:
          scopeProjectId !== void 0 && scopeProjectId === projectId
            ? {
                id: scopeProjectId,
                slug: scopeProjectSlug ?? "",
                name: scopeProjectName ?? "",
                hasFirstMessage,
              }
            : void 0,
        organizationId_: organizationId ?? void 0,
        session,
        routeCapability: route,
        navigationCapability: navigation,
        feedback,
      }),
    [
      scopeProjectId,
      scopeProjectSlug,
      scopeProjectName,
      hasFirstMessage,
      projectId,
      organizationId,
      session,
      route,
      navigation,
      feedback,
    ],
  );
  return <AnalyticsHostProvider value={host}>{children}</AnalyticsHostProvider>;
}
