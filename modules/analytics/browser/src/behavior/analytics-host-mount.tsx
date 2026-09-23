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
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  AnalyticsHostApi,
  AnalyticsHostProvider,
  type AnalyticsFailureNotice,
  type AnalyticsHostProject,
  type AnalyticsRouteReading,
  type AnalyticsSuccessNotice,
} from "../model/analytics-host.ts";

class CapabilityAnalyticsHost extends AnalyticsHostApi {
  private readonly project_: AnalyticsHostProject | undefined;
  private readonly organizationId_: string | undefined;
  private readonly hasPermissionOf: (permission: string) => boolean;
  private readonly routeCapability: UiRoute;
  private readonly navigationCapability: UiNavigation;
  private readonly feedback: UiFeedback;

  constructor({
    project_,
    organizationId_,
    hasPermissionOf,
    routeCapability,
    navigationCapability,
    feedback,
  }: {
    project_: AnalyticsHostProject | undefined;
    organizationId_: string | undefined;
    hasPermissionOf: (permission: string) => boolean;
    routeCapability: UiRoute;
    navigationCapability: UiNavigation;
    feedback: UiFeedback;
  }) {
    super();
    this.project_ = project_;
    this.organizationId_ = organizationId_;
    this.hasPermissionOf = hasPermissionOf;
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

  hasPermission(permission: string): boolean {
    return this.hasPermissionOf(permission);
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

  navigate(to: string): void {
    this.navigationCapability.navigate(to);
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

  // Primitive dependencies only, so the host stays the SAME object across
  // renders that carry the same reading. No capability carries whether
  // anything has ever been ingested — see the handoff for the widening this
  // host is waiting on. `false` keeps the setup prompt showing, the safe
  // direction to be wrong in.
  const host = useMemo(
    () =>
      new CapabilityAnalyticsHost({
        project_:
          scopeProjectId !== void 0 && scopeProjectId === projectId
            ? {
                id: scopeProjectId,
                slug: scopeProjectSlug ?? "",
                name: scopeProjectName ?? "",
                hasFirstMessage: false,
              }
            : void 0,
        organizationId_: organizationId ?? void 0,
        hasPermissionOf: (permission) => session.hasPermission(permission),
        routeCapability: route,
        navigationCapability: navigation,
        feedback,
      }),
    [
      scopeProjectId,
      scopeProjectSlug,
      scopeProjectName,
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
