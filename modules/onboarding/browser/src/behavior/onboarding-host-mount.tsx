/**
 * Onboarding's answer to the port its screens declare: scope and the legacy
 * project key project a `@langwatch/browser-host` capability plus this
 * family's own borrowed `organization.getAll` query. ARCHITECTURE.md §10.1.
 */

import { useUiAddress } from "@langwatch/browser-host/address";
import {
  useUiCapabilities,
  useUiDeclarations,
  useUiScope,
} from "@langwatch/browser-host/capabilities";
import { lazy, useMemo, type ReactNode } from "react";
import { useLocation, useParams } from "react-router";

import {
  OnboardingHostApi,
  OnboardingHostProvider,
  type OnboardingActor,
  type OnboardingFailureNotice,
  type OnboardingFlagReading,
  type OnboardingGovernanceCapability,
  type OnboardingJoinOffer,
  type OnboardingLangyCapability,
  type OnboardingRouteReading,
  type OnboardingScope,
  type OnboardingSessionStatus,
  type OnboardingSidebarCapability,
  type OnboardingSuccessNotice,
} from "../model/onboarding-host.ts";
import { writeToClipboard } from "./browser-clipboard.ts";
import { useOnboardingOrganizationGraph } from "./onboarding-organization-graph.ts";

/**
 * Inert until the shell wires `langy`/`sidebar`/`governance` through
 * `UiCapabilities` (handoff §10) — not a code defect in the meantime.
 */
const INERT_LANGY: OnboardingLangyCapability = {
  dock() {
    /* no panel to dock until the shell wires the langy capability */
  },
  queueKickoff() {
    /* no panel to hand the kickoff to until the shell wires the langy capability */
  },
  onScopeAnnounced() {
    return () => undefined;
  },
};
const INERT_SIDEBAR: OnboardingSidebarCapability = {
  expandGroup() {
    /* no sidebar capability wired yet */
  },
  collapseGroup() {
    /* no sidebar capability wired yet */
  },
  restoreAll() {
    /* no sidebar capability wired yet */
  },
};
const INERT_GOVERNANCE: OnboardingGovernanceCapability = {
  setSampleChoice() {
    /* no governance capability wired yet */
  },
};

/** Same order-sensitive derivation the sibling `authorize`/`api-key` mounts use. */
function sessionStatusOf(hasActor: boolean, isSettled: boolean): OnboardingSessionStatus {
  if (hasActor) return "authenticated";
  return isSettled ? "unauthenticated" : "loading";
}

class CapabilityOnboardingHost extends OnboardingHostApi {
  constructor(
    private readonly deps: {
      scope: OnboardingScope;
      actor: OnboardingActor;
      isSettled: boolean;
      route: OnboardingRouteReading;
      navigate: (to: string) => void;
      replace: (to: string) => void;
      setQuery: (
        next: Readonly<Record<string, string | undefined>>,
        options?: { replace?: boolean },
      ) => void;
      featureFlag: (flag: string) => boolean | undefined;
      projectApiKey: string | undefined;
      succeeded: (notice: OnboardingSuccessNotice) => void;
      failed: (failure: OnboardingFailureNotice) => void;
      langy: OnboardingLangyCapability;
      sidebar: OnboardingSidebarCapability;
      governance: OnboardingGovernanceCapability;
      joinOffers: readonly OnboardingJoinOffer[];
    },
  ) {
    super();
  }

  scope(): OnboardingScope {
    return this.deps.scope;
  }

  currentUser(): OnboardingActor {
    return this.deps.actor;
  }

  sessionStatus(): OnboardingSessionStatus {
    return sessionStatusOf(this.deps.actor !== null, this.deps.isSettled);
  }

  route(): OnboardingRouteReading {
    return this.deps.route;
  }

  navigate(to: string): void {
    this.deps.navigate(to);
  }

  replace(to: string): void {
    this.deps.replace(to);
  }

  /** A whole new document, once the welcome flow minted state a client transition can't carry. */
  hardRedirect(to: string): void {
    if (typeof window !== "undefined") window.location.assign(to);
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.setQuery(next, options);
  }

  featureFlag(flag: string): OnboardingFlagReading {
    const value = this.deps.featureFlag(flag);
    return { enabled: value === true, isLoading: value === void 0 };
  }

  signOut(): void {
    if (typeof window !== "undefined") window.location.assign("/api/auth/logout");
  }

  succeeded(notice: OnboardingSuccessNotice): void {
    this.deps.succeeded(notice);
  }

  failed(failure: OnboardingFailureNotice): void {
    this.deps.failed(failure);
  }

  async copyToClipboard(input: {
    text: string;
    succeeded: OnboardingSuccessNotice;
  }): Promise<boolean> {
    const ok = await writeToClipboard(input.text);
    if (ok) this.deps.succeeded(input.succeeded);
    return ok;
  }

  revealProjectApiKey(): string | undefined {
    return this.deps.projectApiKey;
  }

  prefersReducedMotion(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  langy(): OnboardingLangyCapability {
    return this.deps.langy;
  }

  sidebar(): OnboardingSidebarCapability {
    return this.deps.sidebar;
  }

  governance(): OnboardingGovernanceCapability {
    return this.deps.governance;
  }

  joinOffers(): readonly OnboardingJoinOffer[] {
    return this.deps.joinOffers;
  }
}

export default function OnboardingHostMount({ children }: { children?: ReactNode }) {
  const { session, route, feedback, navigation } = useUiCapabilities();
  const activeScope = useUiScope().activeScope();
  const location = useLocation();
  const asPath = useUiAddress();
  const params = useParams();
  const graph = useOnboardingOrganizationGraph({
    organizationId: activeScope.organizationId ?? void 0,
    projectId: activeScope.projectId ?? void 0,
  });
  const sessionActor = session.currentUser();
  const reading = route.reading();
  const declarations = useUiDeclarations();
  // `lazy` once per declaration, never per render, so the offer is not remounted.
  const joinOffers = useMemo(
    () =>
      declarations
        .declared("joinOffer")
        .map(({ module, capability }) => ({ key: module, JoinOffer: lazy(capability.load) })),
    [declarations],
  );

  const scope: OnboardingScope = useMemo(
    () => ({
      organization: graph.organization,
      organizations: graph.organizations,
      project: graph.activeProject
        ? {
            id: graph.activeProject.project.id,
            name: graph.activeProject.project.name,
            slug: graph.activeProject.project.slug,
          }
        : void 0,
      isLoading: graph.isLoading,
    }),
    [graph],
  );

  const host = useMemo(
    () =>
      new CapabilityOnboardingHost({
        scope,
        actor: sessionActor
          ? { id: sessionActor.id, email: sessionActor.email ?? void 0, name: sessionActor.name }
          : null,
        isSettled: session.isSettled(),
        route: { pathname: location.pathname, asPath, params, query: reading.query },
        navigate: (to) => navigation.navigate(to),
        replace: (to) => navigation.replace(to),
        setQuery: (next, options) => route.setQuery(next, options),
        featureFlag: (flag) => session.featureFlag(flag),
        projectApiKey: graph.activeProject?.project.apiKey ?? void 0,
        succeeded: (notice) => feedback.succeeded(notice),
        failed: (failure) => feedback.failed(failure),
        langy: INERT_LANGY,
        sidebar: INERT_SIDEBAR,
        governance: INERT_GOVERNANCE,
        joinOffers,
      }),
    [
      scope,
      sessionActor,
      session,
      location.pathname,
      asPath,
      params,
      reading.query,
      navigation,
      route,
      graph,
      feedback,
      joinOffers,
    ],
  );

  return <OnboardingHostProvider value={host}>{children}</OnboardingHostProvider>;
}
