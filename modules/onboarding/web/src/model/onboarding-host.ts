/**
 * The one question this package asks the application that mounts it.
 *
 * Same shape every governed web package before it declares: an abstract class
 * the package defines without importing anything of ours, and a plain adapter on
 * the application side. Five screens and ~40 modules moved with their call sites
 * unchanged because the shims in `behavior/` answer the platform hook NAMES off
 * this port.
 *
 * ## `revealProjectApiKey()` IS EXPLICIT, AND THAT IS THE POINT
 *
 * Two surfaces here print the project's legacy base key — the setup guide's
 * "Connect to LangWatch" card and, in `@langwatch/api-key-web`, the `/authorize`
 * handoff. `apps/ui`'s scope graph (`UiScopeOrganization`) carries ids, names and
 * slugs and NO key, deliberately: the base key is a project-level write
 * credential that `organization.getAll` redacts to `""` for anyone without
 * `project:update`, and widening the shell's graph to carry it would put a
 * credential in front of every surface that reads a scope.
 *
 * So the key is a SEPARATE question with a name that says what it does. The host
 * answers it from the same `organization.getAll` read the shell already holds —
 * the same procedure, the same server-side permission check, one cache entry —
 * and answers `undefined` when the reader is not entitled to it. A screen that
 * gets `undefined` renders an empty field, which is exactly what the platform
 * page did with a redacted key.
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
 * What page this is about, and what is still arriving.
 *
 * `isLoading` is the graph's, not the session's: every redirect decision in this
 * family is wrong if it runs before the organizations have answered, which is
 * the bug `resolveWelcomeRedirect`'s docblock is about.
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

export type OnboardingFailureNotice = {
  /**
   * The failure itself, which the composition's presentation registry turns
   * into the sentence a customer reads. Required rather than optional, and the
   * shape `UiFeedbackPort` takes: a notice with no error degrades to the generic
   * line for a failure we could have named.
   */
  readonly error: unknown;
  /** What the reader was doing, for a code the registry does not list. */
  readonly fallbackTitle: string;
  /** A sentence for a refusal the SCREEN made rather than the server. */
  readonly description?: string;
};

export abstract class OnboardingHostPort {
  /** The organization graph and what this page is about. */
  abstract scope(): OnboardingScope;

  abstract currentUser(): OnboardingActor;

  abstract sessionStatus(): OnboardingSessionStatus;

  abstract route(): OnboardingRouteReading;

  /** A client transition, for a move inside this application. */
  abstract navigate(to: string): void;

  abstract replace(to: string): void;

  /**
   * A whole new document.
   *
   * The welcome flow uses it after minting an organization: everything the
   * browser holds — the graph, the permissions, the flags — was read before that
   * organization existed, and a client transition would carry all of it into the
   * first page of the product.
   */
  abstract hardRedirect(to: string): void;

  /** Replaces the whole query string of the current address. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  /**
   * WHAT IS DELIBERATELY NOT HERE: the deployment.
   *
   * `behavior/use-public-env` decodes the `langwatch-public-config` meta tag
   * itself, because half the modules that read it are also mounted by
   * `@langwatch/trace-web`'s Integrate drawer, which mounts no onboarding host.
   * A port method would have thrown there — and did, until trace-web's suite
   * caught it.
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
}

const OnboardingHostContext = createContext<OnboardingHostPort | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const OnboardingHostProvider = OnboardingHostContext.Provider;

/**
 * The host these screens are mounted in.
 *
 * Missing means a screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useOnboardingHost(): OnboardingHostPort {
  const host = useContext(OnboardingHostContext);
  if (!host) {
    throw new Error(
      "No onboarding host is mounted above this screen; render it inside the onboarding frontend feature.",
    );
  }
  return host;
}
