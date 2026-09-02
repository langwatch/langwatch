/**
 * What the billing screens ask of the application they are mounted in.
 *
 * ONE PORT FOR THREE ADDRESSES — `/settings/plans`, `/settings/subscription`
 * and `/settings/usage` — declared here without importing anything of the
 * composing application's. Everything the platform pages read off
 * `useOrganizationTeamProject`, `usePublicEnv`, `useRequiredSession` and the
 * toaster arrives through these methods.
 *
 * THE DEPLOYMENT IS A SETTLED PAIR rather than a bare boolean, for the reason
 * the usage page makes visible: `isSaaS === false` selects the self-hosted
 * branch, which reads a LICENSE, and doing that while the answer is still
 * arriving fires a read that the hosted product has no answer for.
 */

import { createContext, useContext } from "react";
import type { PricingModel } from "./prisma-types";

/** The organization every billing read is scoped to. */
export type BillingHostOrganization = {
  id: string;
  name: string;
  pricingModel: PricingModel | null;
};

export type BillingSuccessNotice = {
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
export type BillingFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
};

export abstract class BillingHostPort {
  /** The organization in scope, or undefined before one resolves. */
  abstract organization(): BillingHostOrganization | undefined;

  /**
   * The team an invitation sent from this page lands in, when there is one.
   *
   * The subscription page invites straight into the reader's active team so a
   * bought seat is usable the moment it is accepted. Undefined means the
   * invitation is organization-wide, which is what the platform page did when
   * no team was in scope.
   */
  abstract activeTeamId(): string | undefined;

  /**
   * The query string the page was opened with.
   *
   * Two keys are read: `success`, which Stripe appends on the way back from a
   * completed checkout, and `upgraded_from`, which says a credit was applied.
   * Both are notices about something that has ALREADY happened, so reading
   * them off the address is the only way the page can know.
   */
  abstract routeQuery(): Readonly<Record<string, string | undefined>>;

  /** Whether this deployment is the hosted product. Fail-safe: false. */
  abstract isSaaS(): boolean;

  /** Whether the answer above has arrived. */
  abstract isDeploymentSettled(): boolean;

  /** Sends the reader somewhere else in the application. */
  abstract navigate(to: string): void;

  /**
   * Leaves the application for a URL it does not serve.
   *
   * A Stripe checkout is a REPLACEMENT of the current document rather than a
   * new tab: the reader comes back to a return address Stripe redirects them
   * to, and opening it beside the page leaves two copies of a checkout.
   */
  abstract leaveTo(url: string): void;

  /**
   * The origin Stripe returns the reader to.
   *
   * `window.location.origin` on the platform pages, asked of the host here so
   * a screen never names `window` — and so a test can say where the checkout
   * came back to.
   */
  abstract applicationOrigin(): string;

  abstract succeeded(notice: BillingSuccessNotice): void;

  abstract failed(failure: BillingFailureNotice): void;
}

const BillingHostContext = createContext<BillingHostPort | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const BillingHostProvider = BillingHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useBillingHost(): BillingHostPort {
  const host = useContext(BillingHostContext);
  if (!host) {
    throw new Error(
      "No billing host is mounted above this screen; render it inside the billing frontend feature.",
    );
  }
  return host;
}
