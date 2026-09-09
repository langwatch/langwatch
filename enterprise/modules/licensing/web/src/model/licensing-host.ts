/**
 * What the license screen asks of the application it is mounted in.
 *
 * The same port shape every settings family since governance has written:
 * declared here without importing anything of the composing application's, so
 * everything the platform page read off `useOrganizationTeamProject`,
 * `usePublicEnv` and the toaster arrives through these methods.
 *
 * `isSaaS` IS A PAIR AND NOT A BOOLEAN — `isSaaS()` and `isDeploymentSettled()`
 * — for the reason `useLicenseActions` states inline: only a CONFIRMED hosted
 * deployment may drop the "restart the server to enable single sign-on" line,
 * and while the environment is still resolving, showing it is the harmless
 * reading. Collapsing the two would omit an operator's one instruction for the
 * length of a round trip.
 */

import { createContext, useContext } from "react";

export type LicensingSuccessNotice = {
  title: string;
  description?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels, never a sentence the screen composed: the words a
 * customer reads are resolved from the error's `code` by the host's
 * presentation registry (#5984).
 */
export type LicensingFailureNotice = {
  error: unknown;
  fallbackTitle: string;
};

export abstract class LicensingHostPort {
  /** The organization the license is read and written against. */
  abstract organizationId(): string | undefined;

  /** Whether this deployment is the hosted product. Fail-safe: false. */
  abstract isSaaS(): boolean;

  /** Whether the answer above has arrived. */
  abstract isDeploymentSettled(): boolean;

  /**
   * Where an operator without a license goes to buy one.
   *
   * The deployment's own Stripe link when it publishes one, and undefined when
   * it does not, which is what makes the card fall back to the public pricing
   * page rather than to a dead link.
   */
  abstract licensePurchaseUrl(): string | undefined;

  /**
   * Drops every cached read.
   *
   * Activating or removing a license moves the ACTIVE PLAN, which half the
   * application reads — navigation, feature gates, limit copy. This replaced a
   * `window.location.reload()`, which refreshed the same state and tore the
   * restart instruction off the screen milliseconds after it appeared.
   */
  abstract refreshPlanDerivedState(): void;

  abstract succeeded(notice: LicensingSuccessNotice): void;

  abstract failed(failure: LicensingFailureNotice): void;
}

const LicensingHostContext = createContext<LicensingHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const LicensingHostProvider = LicensingHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useLicensingHost(): LicensingHostPort {
  const host = useContext(LicensingHostContext);
  if (!host) {
    throw new Error(
      "No licensing host is mounted above this screen; render it inside the licensing frontend feature.",
    );
  }
  return host;
}
