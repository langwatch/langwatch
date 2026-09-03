/**
 * The onboarding package's host port, answered from this application.
 *
 * `@langwatch/onboarding-web` declares what its five screens need — the
 * organization graph, the session, the address, one feature flag, sign-out, the
 * two notices, the clipboard, the reduced-motion preference and the project's
 * base key — as one abstract class it can define without
 * importing anything of ours. This is the other half: a plain adapter over what
 * the application shell has already resolved.
 *
 * Nothing here fetches for a READ. The values arrive as arguments, so the
 * adapter is a value object a test can construct, and the reads that produce
 * them stay in the one component that mounts it.
 *
 * ## `revealProjectApiKey()` DOES NOT WIDEN THE SCOPE GRAPH
 *
 * `UiScopeProject` carries an id, a slug and a name and no credential, and it
 * stays that way. The key arrives here as its own reading, taken off the same
 * `organization.getAll` answer the shell already holds — the same procedure, the
 * same cache entry, and the same server-side `project:update` redaction that
 * decides who may hold one at all. A reader who may not gets `undefined`.
 */

import {
  OnboardingHostPort,
  type OnboardingActor,
  type OnboardingFailureNotice,
  type OnboardingFlagReading,
  type OnboardingOrganization,
  type OnboardingRouteReading,
  type OnboardingScope,
  type OnboardingSessionStatus,
  type OnboardingSuccessNotice,
} from "@langwatch/onboarding-web/screens/onboarding";

export type OnboardingHostReadings = {
  scope: OnboardingScope;
  currentUser: OnboardingActor;
  sessionStatus: OnboardingSessionStatus;
  route: OnboardingRouteReading;
  /** The active project's legacy base key, already redacted by the server. */
  projectApiKey: string | undefined;
  prefersReducedMotion: boolean;
};

export type OnboardingHostActions = {
  navigate: (to: string) => void;
  replace: (to: string) => void;
  leaveTo: (url: string) => void;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  featureFlag: (flag: string) => OnboardingFlagReading;
  signOut: () => void;
  succeeded: (notice: OnboardingSuccessNotice) => void;
  failed: (failure: OnboardingFailureNotice) => void;
  writeClipboard: (text: string) => Promise<void>;
};

export class UiOnboardingHost extends OnboardingHostPort {
  static create(
    readings: OnboardingHostReadings,
    actions: OnboardingHostActions,
  ): UiOnboardingHost {
    return new UiOnboardingHost(readings, actions);
  }

  private constructor(
    private readonly readings: OnboardingHostReadings,
    private readonly actions: OnboardingHostActions,
  ) {
    super();
  }

  scope(): OnboardingScope {
    return this.readings.scope;
  }

  currentUser(): OnboardingActor {
    return this.readings.currentUser;
  }

  sessionStatus(): OnboardingSessionStatus {
    return this.readings.sessionStatus;
  }

  route(): OnboardingRouteReading {
    return this.readings.route;
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }

  replace(to: string): void {
    this.actions.replace(to);
  }

  /**
   * A whole new document, not a client transition.
   *
   * The welcome flow calls this after minting an organization, and the reason is
   * the cache: the graph, the permissions and the flags this document holds were
   * all read before that organization existed. A route change would carry every
   * one of them into the first page of the product.
   */
  hardRedirect(to: string): void {
    this.actions.leaveTo(to);
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  featureFlag(flag: string): OnboardingFlagReading {
    return this.actions.featureFlag(flag);
  }

  signOut(): void {
    this.actions.signOut();
  }

  succeeded(notice: OnboardingSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: OnboardingFailureNotice): void {
    this.actions.failed(failure);
  }

  /**
   * The success notice only goes out once the write has actually resolved.
   *
   * A clipboard write can be refused — Safari private mode, a non-secure context
   * — and the refusal arrives as a rejection rather than as a return value.
   * Telling the reader "copied" for a write that did not happen is worse than
   * saying nothing, because the failure only shows up when they paste a
   * credential that does not work. The api-key family's shape, second use.
   */
  async copyToClipboard({
    text,
    succeeded,
  }: {
    text: string;
    succeeded: OnboardingSuccessNotice;
  }): Promise<boolean> {
    try {
      await this.actions.writeClipboard(text);
      this.actions.succeeded(succeeded);
      return true;
    } catch (error) {
      this.actions.failed({
        error,
        fallbackTitle: "Failed to copy",
        description: "Couldn't copy. Please try again.",
      });
      return false;
    }
  }

  revealProjectApiKey(): string | undefined {
    // An empty string is what the server sends a reader who may not hold the
    // key; it is an absence rather than a key, and the screen renders it as one.
    return this.readings.projectApiKey || void 0;
  }

  prefersReducedMotion(): boolean {
    return this.readings.prefersReducedMotion;
  }
}
