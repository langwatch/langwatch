/**
 * Langy's answer to the port its dock declares: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
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
import { isLangyDemoProject } from "@langwatch/langy-browser-kit";
import { useMemo, type ReactNode } from "react";

import {
  LangyHostApi,
  LangyHostProvider,
  type LangyFailureNotice,
  type LangyHostOrganization,
  type LangyHostOrganizationRole,
  type LangyHostProject,
  type LangyHostTeam,
  type LangyHostUser,
  type LangyRouteReading,
  type LangySuccessNotice,
} from "../model/langy-host.ts";

class CapabilityLangyHost extends LangyHostApi {
  private readonly session: UiSession;
  private readonly navigationCapability: UiNavigation;
  private readonly routeCapability: UiRoute;
  private readonly feedback: UiFeedback;
  private readonly organizationRole_: LangyHostOrganizationRole;
  private readonly isDemoProject_: boolean;

  constructor({
    session,
    navigation,
    route,
    feedback,
    organizationRole,
    isDemoProject,
  }: {
    session: UiSession;
    navigation: UiNavigation;
    route: UiRoute;
    feedback: UiFeedback;
    organizationRole: LangyHostOrganizationRole;
    isDemoProject: boolean;
  }) {
    super();
    this.session = session;
    this.navigationCapability = navigation;
    this.routeCapability = route;
    this.feedback = feedback;
    this.organizationRole_ = organizationRole;
    this.isDemoProject_ = isDemoProject;
  }

  project(): LangyHostProject | undefined {
    const project = this.session.snapshot().scope.project;
    return project ? { id: project.id, slug: project.slug, name: project.name } : void 0;
  }

  organization(): LangyHostOrganization | undefined {
    const organization = this.session.snapshot().scope.organization;
    return organization ? { id: organization.id, name: organization.name } : void 0;
  }

  team(): LangyHostTeam | undefined {
    const team = this.session.snapshot().scope.team;
    return team ? { id: team.id, name: team.name } : void 0;
  }

  organizationRole(): LangyHostOrganizationRole {
    return this.organizationRole_;
  }

  currentUser(): LangyHostUser | undefined {
    const actor = this.session.currentUser();
    return actor
      ? { id: actor.id, name: actor.name, email: actor.email, image: actor.image }
      : void 0;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  isLoading(): boolean {
    return this.session.snapshot().scope.status === "loading";
  }

  isDemoProject(): boolean {
    return this.isDemoProject_;
  }

  featureFlag(flag: string): boolean | undefined {
    return this.session.featureFlag(flag);
  }

  route(): LangyRouteReading {
    const reading = this.routeCapability.reading();
    return { params: reading.params, query: reading.query, pathname: reading.pathname ?? "" };
  }

  /** MERGES into the query, unlike the capability's own REPLACE semantics. */
  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    const current = this.routeCapability.reading().query;
    this.routeCapability.setQuery({ ...current, ...next }, options);
  }

  navigate(to: string, options?: { replace?: boolean }): void {
    if (options?.replace) this.navigationCapability.replace(to);
    else this.navigationCapability.navigate(to);
  }

  /** No billing capability exists here; undefined is the honest reading. */
  planManagementUrl(): string | undefined {
    return void 0;
  }

  succeeded(notice: LangySuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: LangyFailureNotice): void {
    this.feedback.failed(failure);
  }
}

/**
 * The provider `mounts.load` would resolve. NOT YET WIRED: `modules/langy/browser`
 * has no `defineWebModule` to hang `.withHosts()` off — see the handoff.
 */
export default function LangyHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const deployment = useUiDeployment();
  const organizationRole = useUiScope().scopeHost()?.organizationRole();
  const projectSlug = session.snapshot().scope.project?.slug;
  const isDemoProject = isLangyDemoProject({
    projectSlug,
    demoProjectSlug: deployment.demoProjectSlug,
  });

  const host = useMemo(
    () =>
      new CapabilityLangyHost({
        session,
        navigation,
        route,
        feedback,
        organizationRole,
        isDemoProject,
      }),
    [session, navigation, route, feedback, organizationRole, isDemoProject],
  );
  return <LangyHostProvider value={host}>{children}</LangyHostProvider>;
}
