/**
 * The page's host and product analytics, answering for another project: on a page about no
 * project of its own (Gateway, Coding agents) navigation names the one the section works in.
 */

import {
  UiAnalytics,
  type UiAnalyticsEvent,
  type UiAnalyticsGroup,
  type UiAnalyticsReader,
} from "@langwatch/browser-host/analytics";

import {
  AnalyticsHostApi,
  type AnalyticsAlertAuthoring,
  type AnalyticsFailureNotice,
  type AnalyticsHostProject,
  type AnalyticsLangyAskRequest,
  type AnalyticsLangyDraftAbout,
  type AnalyticsReleaseFlag,
  type AnalyticsRouteReading,
  type AnalyticsSuccessNotice,
} from "./analytics-host.ts";

/** The project and its grants are that project's; everything else is the page host's answer. */
class AnalyticsHostInProject extends AnalyticsHostApi {
  private readonly host: AnalyticsHostApi;
  private readonly inProject: AnalyticsHostProject;

  constructor({ host, inProject }: { host: AnalyticsHostApi; inProject: AnalyticsHostProject }) {
    super();
    this.host = host;
    this.inProject = inProject;
  }

  project(): AnalyticsHostProject {
    return this.inProject;
  }

  organizationId(): string | undefined {
    return this.host.organizationId();
  }

  organizationName(): string | undefined {
    return this.host.organizationName();
  }

  userId(): string | undefined {
    return this.host.userId();
  }

  hasPermission(permission: string): boolean {
    // On the page's own project the session already holds the grants, and no read is spent.
    if (this.host.project()?.id === this.inProject.id) return this.host.hasPermission(permission);
    return this.host.hasPermissionIn({ projectId: this.inProject.id, permission });
  }

  hasPermissionIn({ projectId, permission }: { projectId: string; permission: string }): boolean {
    return this.host.hasPermissionIn({ projectId, permission });
  }

  isSettled(): boolean {
    return this.host.isSettled();
  }

  featureFlag(flag: AnalyticsReleaseFlag): boolean | undefined {
    return this.host.featureFlag(flag);
  }

  route(): AnalyticsRouteReading {
    return this.host.route();
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.host.setQuery(next, options);
  }

  navigate(to: string, options?: { replace?: boolean }): void {
    this.host.navigate(to, options);
  }

  openAutomationDrawer(request: AnalyticsAlertAuthoring): void {
    this.host.openAutomationDrawer(request);
  }

  succeeded(notice: AnalyticsSuccessNotice): void {
    this.host.succeeded(notice);
  }

  failed(failure: AnalyticsFailureNotice): void {
    this.host.failed(failure);
  }

  askLangy(request: AnalyticsLangyAskRequest): void {
    this.host.askLangy(request);
  }

  showLangy(about: AnalyticsLangyDraftAbout | null): void {
    this.host.showLangy(about);
  }
}

/** `host`, with `project` as the project in scope and its grants as the ones asked. */
export function analyticsHostInProject({
  host,
  project,
}: {
  host: AnalyticsHostApi;
  project: Pick<AnalyticsHostProject, "id" | "slug" | "name">;
}): AnalyticsHostApi {
  // The section never asks about first traces, so no read is spent on them.
  return new AnalyticsHostInProject({ host, inProject: { ...project, hasFirstMessage: true } });
}

/** Every event carries `projectId`, which wins over the page's registered one. */
class UiAnalyticsInProject extends UiAnalytics {
  private readonly analytics: UiAnalytics;
  private readonly projectId: string;

  constructor({ analytics, projectId }: { analytics: UiAnalytics; projectId: string }) {
    super();
    this.analytics = analytics;
    this.projectId = projectId;
  }

  track(event: UiAnalyticsEvent): void {
    this.analytics.track({
      ...event,
      attributes: { ...event.attributes, projectId: this.projectId },
    });
  }

  register(properties: Readonly<Record<string, unknown>>): void {
    this.analytics.register(properties);
  }

  unregister(property: string): void {
    this.analytics.unregister(property);
  }

  identify(reader: UiAnalyticsReader): void {
    this.analytics.identify(reader);
  }

  group(organization: UiAnalyticsGroup): void {
    this.analytics.group(organization);
  }

  reset(): void {
    this.analytics.reset();
  }
}

/**
 * `analytics`, sending every event as about `projectId`: the shell registers the page's project
 * on each event, and a board made from Gateway or Coding agents belongs to another one.
 */
export function uiAnalyticsInProject({
  analytics,
  projectId,
}: {
  analytics: UiAnalytics;
  projectId: string;
}): UiAnalytics {
  return new UiAnalyticsInProject({ analytics, projectId });
}
