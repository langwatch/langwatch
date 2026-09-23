/**
 * Organization's answer to the port its five settings screens declare: scope
 * and grants project a `@langwatch/browser-host` capability plus this
 * family's own borrowed `organization.getAll` query. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiDeclarations,
  useUiDeployment,
  useUiScope,
} from "@langwatch/browser-host/capabilities";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { lazy, useMemo, type ReactNode } from "react";

import {
  OrganizationHostApi,
  OrganizationHostProvider,
  type AuthenticationOverviewCard,
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
      isFeatureEnabled: (flag: string) => boolean;
      openOverlay: (name: string, props?: Record<string, unknown>) => void;
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

  isFeatureEnabled(flag: string): boolean {
    return this.deps.isFeatureEnabled(flag);
  }

  openOverlay(name: string, props?: Record<string, unknown>): void {
    this.deps.openOverlay(name, props);
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

  /** No switcher is mounted below the root layout; the port says null is an answer. */
  projectSwitcher(): ReactNode | null {
    return null;
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

  failed(failure: OrganizationFailureNotice): void {
    this.deps.failed(failure);
  }
}

export default function OrganizationHostMount({ children }: { children?: ReactNode }) {
  const { session, route, feedback, navigation } = useUiCapabilities();
  const deployment = useUiDeployment();
  const uiScope = useUiScope();
  const activeScope = uiScope.activeScope();
  const scopeHost = uiScope.scopeHost();
  const { openDrawer, closeDrawer } = useDrawer();
  const graph = useOrganizationGraph({
    organizationId: activeScope.organizationId ?? void 0,
    projectId: activeScope.projectId ?? void 0,
  });
  const facts = useUiOrganizationFacts();
  const sessionActor = session.currentUser();
  const reading = route.reading();
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so a card is not remounted.
  const overviewCards = useMemo(
    () =>
      declarations
        .declared("authenticationOverviewCard")
        .toSorted(
          (left, right) =>
            Number(right.capability.section === "sign-in") -
            Number(left.capability.section === "sign-in"),
        )
        .map(({ module, capability }) => ({ key: module, Card: lazy(capability.load) })),
    [declarations],
  );

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
        hasOrganizationPermission: (permission) =>
          scopeHost
            ? scopeHost.hasOrganizationPermission(permission)
            : session.hasPermission(permission),
        actor: sessionActor ?? void 0,
        activeProject: graph.activeProject?.project,
        isEnterprise: facts.isEnterprise,
        isPlanLoading: facts.isPlanLoading,
        hasEmailProvider: deployment.hasEmailProvider,
        isFeatureEnabled: (flag) => session.isFeatureEnabled(flag),
        openOverlay: (name, props) => openDrawer(name, props),
        closeOverlay: () => closeDrawer(),
        succeeded: (notice) => feedback.succeeded(notice),
        route: { params: reading.params, query: reading.query },
        setQuery: (next, options) => route.setQuery(next, options),
        navigate: (to) => navigation.navigate(to),
        failed: (failure) => feedback.failed(failure),
        overviewCards,
      }),
    [
      activeScope.organizationId,
      activeScope.projectId,
      graph,
      session,
      scopeHost,
      sessionActor,
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
    ],
  );

  return <OrganizationHostProvider value={host}>{children}</OrganizationHostProvider>;
}
