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
import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { useLentOperations } from "@langwatch/browser-host/lent";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { LangyAskToken, type LangyAsk } from "@langwatch/langy-client";
import { useMemo, type ReactNode } from "react";

import {
  AnalyticsHostApi,
  AnalyticsHostProvider,
  type AnalyticsAlertAuthoring,
  type AnalyticsFailureNotice,
  type AnalyticsHostProject,
  type AnalyticsLangyAskRequest,
  type AnalyticsLangyDraftAbout,
  type AnalyticsReleaseFlag,
  type AnalyticsRouteReading,
  type AnalyticsSuccessNotice,
} from "../model/analytics-host.ts";
import { automationDrawerAddress } from "../model/analytics-overlay-address.ts";
import { analyticsApi } from "./analytics-api.ts";

class CapabilityAnalyticsHost extends AnalyticsHostApi {
  private readonly project_: AnalyticsHostProject | undefined;
  private readonly organizationId_: string | undefined;
  private readonly organizationName_: string | undefined;
  private readonly session: UiSession;
  private readonly flags: Readonly<Record<AnalyticsReleaseFlag, boolean | undefined>>;
  private readonly routeCapability: UiRoute;
  private readonly navigationCapability: UiNavigation;
  private readonly feedback: UiFeedback;
  private readonly langy: (() => Promise<LangyAsk>) | undefined;

  constructor({
    project_,
    organizationId_,
    organizationName_,
    session,
    flags,
    routeCapability,
    navigationCapability,
    feedback,
    langy,
  }: {
    project_: AnalyticsHostProject | undefined;
    organizationId_: string | undefined;
    organizationName_: string | undefined;
    session: UiSession;
    flags: Readonly<Record<AnalyticsReleaseFlag, boolean | undefined>>;
    routeCapability: UiRoute;
    navigationCapability: UiNavigation;
    feedback: UiFeedback;
    langy: (() => Promise<LangyAsk>) | undefined;
  }) {
    super();
    this.project_ = project_;
    this.organizationId_ = organizationId_;
    this.organizationName_ = organizationName_;
    this.session = session;
    this.flags = flags;
    this.routeCapability = routeCapability;
    this.navigationCapability = navigationCapability;
    this.feedback = feedback;
    this.langy = langy;
  }

  project(): AnalyticsHostProject | undefined {
    return this.project_;
  }

  organizationId(): string | undefined {
    return this.organizationId_;
  }

  organizationName(): string | undefined {
    return this.organizationName_;
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

  featureFlag(flag: AnalyticsReleaseFlag): boolean | undefined {
    return this.flags[flag];
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

  /** Through what Langy lends by token; with Langy not installed nothing is lent. */
  askLangy(request: AnalyticsLangyAskRequest): void {
    if (!this.langy) return;
    void this.langy().then((langy) => langy.ask(request));
  }

  showLangy(about: AnalyticsLangyDraftAbout | null): void {
    if (!this.langy) return;
    void this.langy().then((langy) => langy.onScreen(about));
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because
 * that is what `mounts.load` resolves.
 */
export default function AnalyticsHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const langy = useLentOperations(LangyAskToken);
  // Read as primitives: the flags service hands a new object on every render.
  const uiFlags = useUiFlags();
  const dashboardsFlag = uiFlags.flag(FrontendFlags.release_dashboards);
  const langyFlag = uiFlags.flag(FrontendFlags.release_langy_enabled);
  const { organizationId, projectId } = useUiScope().activeScope();
  const scopeProject = session.snapshot().scope.project;
  const scopeProjectId = scopeProject?.id;
  const scopeProjectSlug = scopeProject?.slug;
  const scopeProjectName = scopeProject?.name;
  const scopeOrganizationName = session.snapshot().scope.organization?.name;

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
        organizationName_: scopeOrganizationName,
        session,
        flags: { release_dashboards: dashboardsFlag, release_langy_enabled: langyFlag },
        routeCapability: route,
        navigationCapability: navigation,
        feedback,
        langy,
      }),
    [
      scopeProjectId,
      scopeProjectSlug,
      scopeProjectName,
      hasFirstMessage,
      projectId,
      organizationId,
      scopeOrganizationName,
      session,
      dashboardsFlag,
      langyFlag,
      route,
      navigation,
      feedback,
      langy,
    ],
  );
  return <AnalyticsHostProvider value={host}>{children}</AnalyticsHostProvider>;
}
