/**
 * Abstract port the application implements to answer scope and API key queries;
 * key is separate to avoid spreading credentials across unrelated surfaces.
 */

import { createContext, useContext } from "react";

/** One project, as narrowly as these screens read one. */
export type OnboardingProject = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
};

/** One team in the reader's graph, as the welcome redirect walks it. */
export type OnboardingTeam = {
  readonly id: string;
  readonly name: string;
  readonly isPersonal: boolean;
  readonly projects: readonly OnboardingProject[];
};

/** One organization in the reader's graph. */
export type OnboardingOrganization = {
  readonly id: string;
  readonly name: string;
  readonly primaryIntent: string | null;
  readonly teams: readonly OnboardingTeam[];
};

/**
 * What page this is about, and what is still arriving. `isLoading` is the
 * graph's, not the session's — every redirect decision here is wrong if it
 * runs before organizations answer (see `resolveWelcomeRedirect`'s docblock).
 */
export type OnboardingScope = {
  readonly organization: OnboardingOrganization | undefined;
  readonly organizations: readonly OnboardingOrganization[] | undefined;
  readonly project: OnboardingProject | undefined;
  readonly isLoading: boolean;
};

/** Who is reading, or `null` while nobody is. */
export type OnboardingActor = { readonly id: string; readonly email?: string } | null;

export type OnboardingSessionStatus = "loading" | "authenticated" | "unauthenticated";

/** The address, in the two halves the moved `useRouter` call sites read. */
export type OnboardingRouteReading = {
  readonly pathname: string;
  readonly asPath: string;
  readonly params: Readonly<Record<string, string | undefined>>;
  readonly query: Readonly<Record<string, string | undefined>>;
};

/** A flag reading that keeps its pending state, because a fork depends on it. */
export type OnboardingFlagReading = { readonly enabled: boolean; readonly isLoading: boolean };

export type OnboardingSuccessNotice = {
  readonly title: string;
  readonly description?: string;
};

/**
 * A landing's kickoff brief, exactly as the tour builds it
 * (`features/guided-onboarding/model/kickoff.ts`). Typed here so the host
 * capability's signature is checked, without the host importing the panel.
 */
export type OnboardingLangyKickoff = Readonly<Record<string, unknown>> & {
  readonly path: string;
};

/**
 * Langy panel operations, so no screen imports `modules/langy/browser`
 * directly — a peer, published through its own `withCapabilities` slot.
 * ARCHITECTURE.md §10.1 "a capability travels by declaration".
 */
export type OnboardingLangyCapability = {
  /** Opens the panel docked to the sidebar, before a tour or a kickoff. */
  dock(): void;
  /** Hands the panel a kickoff brief once its scope is announced. */
  queueKickoff(kickoff: OnboardingLangyKickoff): void;
  /**
   * Fires once the panel announces `organizationId`'s scope; returns the
   * unsubscribe, for a kickoff still pending when the host unmounts.
   */
  onScopeAnnounced(organizationId: string, callback: () => void): () => void;
};

/** Sidebar group fold/expand/restore, published by navigation's declaration. */
export type OnboardingSidebarCapability = {
  expandGroup(id: string): void;
  collapseGroup(id: string): void;
  /** Drops every override; each group returns to its remembered preference. */
  restoreAll(): void;
};

/** The governance sample-data toggle a tour flips on and off. */
export type OnboardingGovernanceCapability = {
  setSampleChoice(choice: boolean): void;
};

export type OnboardingFailureNotice = {
  /**
   * The failure itself, which the composition's presentation registry turns
   * into the sentence a customer reads. Required, not optional — a notice
   * with no error degrades to the generic line for a failure we could have named.
   */
  readonly error: unknown;
  /** What the reader was doing, for a code the registry does not list. */
  readonly fallbackTitle: string;
  /** A sentence for a refusal the SCREEN made rather than the server. */
  readonly description?: string;
};

export abstract class OnboardingHostApi {
  /** The organization graph and what this page is about. */
  abstract scope(): OnboardingScope;

  abstract currentUser(): OnboardingActor;

  abstract sessionStatus(): OnboardingSessionStatus;

  abstract route(): OnboardingRouteReading;

  /** A client transition, for a move inside this application. */
  abstract navigate(to: string): void;

  abstract replace(to: string): void;

  /**
   * A whole new document. The welcome flow uses it after minting an
   * organization: everything the browser holds (graph, permissions, flags)
   * was read before it existed, and a client transition would carry that in.
   */
  abstract hardRedirect(to: string): void;

  /** Replaces the whole query string of the current address. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  /**
   * Deployment config is not here; see use-public-env to support modules shared
   * with packages that don't mount this host.
   */

  abstract featureFlag(flag: string): OnboardingFlagReading;

  abstract signOut(): void;

  abstract succeeded(notice: OnboardingSuccessNotice): void;

  abstract failed(failure: OnboardingFailureNotice): void;

  /** Writes to the clipboard and says the right thing either way. */
  abstract copyToClipboard(input: {
    text: string;
    succeeded: OnboardingSuccessNotice;
  }): Promise<boolean>;

  /**
   * The project's legacy base key, or `undefined` when the reader may not hold
   * it. See the module docblock: this is a separate question on purpose.
   */
  abstract revealProjectApiKey(): string | undefined;

  /** Whether this reader asked their operating system for less motion. */
  abstract prefersReducedMotion(): boolean;

  /** Langy panel control for a guided landing; see {@link OnboardingLangyCapability}. */
  abstract langy(): OnboardingLangyCapability;

  /** Sidebar group fold/expand/restore; see {@link OnboardingSidebarCapability}. */
  abstract sidebar(): OnboardingSidebarCapability;

  /** The governance sample-data toggle; see {@link OnboardingGovernanceCapability}. */
  abstract governance(): OnboardingGovernanceCapability;
}

const OnboardingHostContext = createContext<OnboardingHostApi | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const OnboardingHostProvider = OnboardingHostContext.Provider;

/**
 * The host these screens are mounted in. Missing means a screen was rendered
 * outside the frontend feature that owns it — a composition fault, not
 * something a screen can degrade around.
 */
export function useOnboardingHost(): OnboardingHostApi {
  const host = useContext(OnboardingHostContext);
  if (!host) {
    throw new Error(
      "No onboarding host is mounted above this screen; render it inside the onboarding frontend feature.",
    );
  }
  return host;
}
