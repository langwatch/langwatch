/**
 * Onboarding's answer to the port its screens declare: scope and the legacy
 * project key project a `@langwatch/browser-host` host service plus this
 * family's own borrowed `organization.getAll` query. ARCHITECTURE.md §10.1.
 */

import { useUiAddress } from "@langwatch/browser-host/address";
import { useUiHostServices, useUiScope } from "@langwatch/browser-host/capabilities";
import type { ReleaseFlagToken } from "@langwatch/browser-host/declarations";
import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { useLent, useLentHooks } from "@langwatch/browser-host/lent";
import { SampleChoiceToken } from "@langwatch/enterprise-governance-client";
import { GuidedOnboardingToken, type LangyGuidedOnboarding } from "@langwatch/langy-client";
import { SidebarToken } from "@langwatch/navigation-client";
import { JoinOfferToken } from "@langwatch/organization-client";
import { useMemo, type ReactNode } from "react";
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
import { useOnboardingOrganizationGraph } from "./onboarding-organization-graph.ts";

/**
 * The one DOM ability neither port's capabilities carry: writing to the
 * clipboard. Mirrors `@langwatch/browser-host`'s own `CopyButton`, which
 * touches `navigator.clipboard` the same way rather than through a port.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** What a composition without Langy reads: nothing to dock, nothing to hand a kickoff to. */
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
/** Langy's lent capability, keyed by the organization its scope must announce. */
function langyCapabilityOf(lent: LangyGuidedOnboarding | undefined): OnboardingLangyCapability {
  if (!lent) return INERT_LANGY;
  return {
    dock: () => lent.dock(),
    queueKickoff: (kickoff) => lent.queueKickoff(kickoff),
    onScopeAnnounced: (organizationId, callback) =>
      lent.onScopeAnnounced((scope) => {
        if (scope.organizationId === null || scope.organizationId === organizationId) callback();
      }),
  };
}

const INERT_SIDEBAR: OnboardingSidebarCapability = {
  expandGroup() {
    /* no navigation module installed */
  },
  collapseGroup() {
    /* no navigation module installed */
  },
  restoreAll() {
    /* no navigation module installed */
  },
};
const INERT_GOVERNANCE: OnboardingGovernanceCapability = {
  setSampleChoice() {
    /* no governance module installed */
  },
};

/** Same order-sensitive derivation the sibling `authorize`/`api-key` mounts use. */
function sessionStatusOf(hasActor: boolean, isSettled: boolean): OnboardingSessionStatus {
  if (hasActor) return "authenticated";
  return isSettled ? "unauthenticated" : "loading";
}

class HostServiceOnboardingHost extends OnboardingHostApi {
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
      featureFlag: (flag: ReleaseFlagToken) => boolean | undefined;
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

  featureFlag(flag: ReleaseFlagToken): OnboardingFlagReading {
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
  const { session, route, feedback, navigation } = useUiHostServices();
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
  // `useLent` makes the component once per declaration set, so the offer is not remounted.
  const LentJoinOffer = useLent(JoinOfferToken);
  const joinOffers = useMemo(
    () => (LentJoinOffer ? [{ key: JoinOfferToken.owner, JoinOffer: LentJoinOffer }] : []),
    [LentJoinOffer],
  );

  const lentLangy = useLentHooks(GuidedOnboardingToken);
  const langy = useMemo(() => langyCapabilityOf(lentLangy), [lentLangy]);

  const sidebar = useLentHooks(SidebarToken) ?? INERT_SIDEBAR;
  const flags = useUiFlags();

  const governance = useLentHooks(SampleChoiceToken) ?? INERT_GOVERNANCE;

  const scopeProjectKind = session.snapshot().scope.project?.kind;
  const scope: OnboardingScope = useMemo(
    () => ({
      organization: graph.organization,
      organizations: graph.organizations,
      project: graph.activeProject
        ? {
            id: graph.activeProject.project.id,
            name: graph.activeProject.project.name,
            slug: graph.activeProject.project.slug,
            ...(scopeProjectKind !== void 0 ? { kind: scopeProjectKind } : {}),
          }
        : void 0,
      isLoading: graph.isLoading,
    }),
    [graph, scopeProjectKind],
  );

  const host = useMemo(
    () =>
      new HostServiceOnboardingHost({
        scope,
        actor: sessionActor
          ? { id: sessionActor.id, email: sessionActor.email ?? void 0, name: sessionActor.name }
          : null,
        isSettled: session.isSettled(),
        route: { pathname: location.pathname, asPath, params, query: reading.query },
        navigate: (to) => navigation.navigate(to),
        replace: (to) => navigation.replace(to),
        setQuery: (next, options) => route.setQuery(next, options),
        featureFlag: (flag) => flags.flag(flag),
        succeeded: (notice) => feedback.succeeded(notice),
        failed: (failure) => feedback.failed(failure),
        langy,
        sidebar,
        governance,
        joinOffers,
      }),
    [
      scope,
      sessionActor,
      session,
      flags,
      location.pathname,
      asPath,
      params,
      reading.query,
      navigation,
      route,
      feedback,
      joinOffers,
      langy,
      sidebar,
      governance,
    ],
  );

  return <OnboardingHostProvider value={host}>{children}</OnboardingHostProvider>;
}
