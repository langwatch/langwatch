/**
 * Organization's answer to the port its five settings screens declare: scope
 * and grants project a `@langwatch/browser-host` capability plus this
 * family's own `organization.getScopeGraph` query. ARCHITECTURE.md §10.1.
 */

import {
  useUiHostServices,
  useUiDeployment,
  useUiScope,
} from "@langwatch/browser-host/capabilities";
import type { ReleaseFlagToken, UiDrawerToken } from "@langwatch/browser-host/declarations";
import { useDrawer } from "@langwatch/browser-host/drawer";
import { useUiFlags, type UiFlags } from "@langwatch/browser-host/feature-flag";
import { useLent, useLentAll } from "@langwatch/browser-host/lent";
import { DirectorySummaryToken } from "@langwatch/enterprise-scim-client";
import { AuthenticationOverviewCardToken } from "@langwatch/organization-client";
import { ProjectSwitcherToken } from "@langwatch/project-client";
import type { ProjectSwitcherProps } from "@langwatch/project-contract";
import { Suspense, useMemo, type ComponentType, type ReactNode } from "react";

import {
  OrganizationHostApi,
  OrganizationHostProvider,
  type AuthenticationOverviewCard,
  type DirectorySummaryBand,
  type OrganizationActor,
  type OrganizationDownload,
  type OrganizationFailureNotice,
  type OrganizationProjectReading,
  type OrganizationReading,
  type OrganizationRouteReading,
  type OrganizationScope,
  type OrganizationSuccessNotice,
} from "../model/organization-host.ts";
import { downloadInBrowser } from "./browser-download.ts";
import { useOrganizationGraph } from "./organization-graph.ts";
import { useUiOrganizationFacts } from "./ui-organization-facts.ts";

class CapabilityOrganizationHost extends OrganizationHostApi {
  constructor(
    private readonly deps: {
      scope: OrganizationScope;
      organization: OrganizationReading | undefined;
      hasPermission: (permission: string) => boolean;
      hasOrganizationPermission: (permission: string) => boolean;
      actor: OrganizationActor | undefined;
      activeProject: OrganizationProjectReading | undefined;
      isEnterprise: boolean;
      isPlanLoading: boolean;
      /** Whether this deployment can send the invitation rather than only mint a link. */
      hasEmailProvider: boolean;
      flags: UiFlags;
      openOverlay: <Props>(drawer: UiDrawerToken<Props>, props?: Partial<Props>) => void;
      closeOverlay: () => void;
      succeeded: (notice: OrganizationSuccessNotice) => void;
      route: OrganizationRouteReading;
      setQuery: (
        next: Readonly<Record<string, string | undefined>>,
        options?: { replace?: boolean },
      ) => void;
      navigate: (to: string) => void;
      failed: (failure: OrganizationFailureNotice) => void;
      overviewCards: readonly AuthenticationOverviewCard[];
      directorySummary: DirectorySummaryBand | undefined;
      Switcher: ComponentType<ProjectSwitcherProps> | undefined;
    },
  ) {
    super();
  }

  scope(): OrganizationScope {
    return this.deps.scope;
  }

  organization(): OrganizationReading | undefined {
    return this.deps.organization;
  }

  hasPermission(permission: string): boolean {
    return this.deps.hasPermission(permission);
  }

  hasOrganizationPermission(permission: string): boolean {
    return this.deps.hasOrganizationPermission(permission);
  }

  currentUser(): OrganizationActor | undefined {
    return this.deps.actor;
  }

  activeProject(): OrganizationProjectReading | undefined {
    return this.deps.activeProject;
  }

  isEnterprise(): boolean {
    return this.deps.isEnterprise;
  }

  isPlanLoading(): boolean {
    return this.deps.isPlanLoading;
  }

  hasEmailProvider(): boolean {
    return this.deps.hasEmailProvider;
  }

  isFeatureEnabled(flag: ReleaseFlagToken): boolean {
    return this.deps.flags.flag(flag) === true;
  }

  openOverlay<Props>(drawer: UiDrawerToken<Props>, props?: Partial<Props>): void {
    this.deps.openOverlay(drawer, props);
  }

  closeOverlay(): void {
    this.deps.closeOverlay();
  }

  succeeded(notice: OrganizationSuccessNotice): void {
    this.deps.succeeded(notice);
  }

  route(): OrganizationRouteReading {
    return this.deps.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.setQuery(next, options);
  }

  /** The switcher project lends by token (ARCHITECTURE §10), as main's audit log header. */
  projectSwitcher(): ReactNode | null {
    const { Switcher } = this.deps;
    if (!Switcher) return null;
    return (
      <Suspense fallback={null}>
        <Switcher />
      </Suspense>
    );
  }

  navigate(to: string): void {
    this.deps.navigate(to);
  }

  download(file: OrganizationDownload): void {
    downloadInBrowser(file);
  }

  signOut(): void {
    if (typeof window !== "undefined") window.location.assign("/api/auth/logout");
  }

  authenticationOverviewCards(): readonly AuthenticationOverviewCard[] {
    return this.deps.overviewCards;
  }

  directorySummary(): DirectorySummaryBand | undefined {
    return this.deps.directorySummary;
  }

  failed(failure: OrganizationFailureNotice): void {
    this.deps.failed(failure);
  }
}

export default function OrganizationHostMount({ children }: { children?: ReactNode }) {
  const { session, route, feedback, navigation } = useUiHostServices();
  const deployment = useUiDeployment();
  const uiScope = useUiScope();
  const activeScope = uiScope.activeScope();
  const { openDrawer, closeDrawer } = useDrawer();
  const sessionActor = session.currentUser();
  const graph = useOrganizationGraph({
    organizationId: activeScope.organizationId ?? void 0,
    projectId: activeScope.projectId ?? void 0,
    signedIn: !!sessionActor,
  });
  const facts = useUiOrganizationFacts();
  const flags = useUiFlags();
  const reading = route.reading();
  const lentCards = useLentAll(AuthenticationOverviewCardToken);
  const overviewCards = useMemo(
    () => lentCards.map(({ owner, Component }) => ({ key: owner, Card: Component })),
    [lentCards],
  );
  const directorySummary = useLent(DirectorySummaryToken);
  const Switcher = useLent(ProjectSwitcherToken);

  const host = useMemo(
    () =>
      new CapabilityOrganizationHost({
        scope: {
          organizationId: activeScope.organizationId ?? void 0,
          projectId: activeScope.projectId ?? void 0,
          projectSlug: graph.activeProject?.project.slug,
        },
        organization: graph.organization,
        hasPermission: (permission) => session.hasPermission(permission),
        hasOrganizationPermission: (permission) => session.hasOrganizationPermission(permission),
        actor: sessionActor ?? void 0,
        activeProject: graph.activeProject?.project,
        isEnterprise: facts.isEnterprise,
        isPlanLoading: facts.isPlanLoading,
        hasEmailProvider: deployment.hasEmailProvider,
        flags,
        openOverlay: (drawer, props) => openDrawer(drawer, props),
        closeOverlay: () => closeDrawer(),
        succeeded: (notice) => feedback.succeeded(notice),
        route: { params: reading.params, query: reading.query },
        setQuery: (next, options) => route.setQuery(next, options),
        navigate: (to) => navigation.navigate(to),
        failed: (failure) => feedback.failed(failure),
        overviewCards,
        directorySummary,
        Switcher,
      }),
    [
      activeScope.organizationId,
      activeScope.projectId,
      graph,
      session,
      sessionActor,
      flags,
      facts.isEnterprise,
      facts.isPlanLoading,
      deployment.hasEmailProvider,
      openDrawer,
      closeDrawer,
      feedback,
      reading,
      route,
      navigation,
      overviewCards,
      directorySummary,
      Switcher,
    ],
  );

  return <OrganizationHostProvider value={host}>{children}</OrganizationHostProvider>;
}
