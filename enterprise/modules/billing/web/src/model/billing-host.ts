/**
 * Port for billing screens at three addresses. Deployment is a settled pair
 * to handle self-hosted reads that hosted product doesn't answer.
 */

import { createContext, useContext } from "react";
import type { PricingModel } from "./prisma-types.ts";

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
 * A failure, as the screen knows it. The raw `error` travels, never a
 * sentence the screen composed — words are resolved from `code` via the
 * host's presentation registry (#5984).
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
   * The team an invitation from this page lands in. The subscription page
   * invites into the reader's active team so a bought seat is usable at
   * once; undefined means organization-wide, as the platform page did.
   */
  abstract activeTeamId(): string | undefined;

  /**
   * The query string the page was opened with. Two keys matter: `success`
   * (Stripe appends it after checkout) and `upgraded_from` (a credit was
   * applied) — both notices of something already done, read off the address.
   */
  abstract routeQuery(): Readonly<Record<string, string | undefined>>;

  /** Whether this deployment is the hosted product. Fail-safe: false. */
  abstract isSaaS(): boolean;

  /** Whether the answer above has arrived. */
  abstract isDeploymentSettled(): boolean;

  /** Sends the reader somewhere else in the application. */
  abstract navigate(to: string): void;

  /**
   * Leaves the application for a URL it does not serve. A Stripe checkout
   * replaces the current document rather than opening a new tab, so the
   * reader returns to this same page instead of leaving two copies open.
   */
  abstract leaveTo(url: string): void;

  /**
   * The origin Stripe returns the reader to — `window.location.origin` on
   * the platform pages, asked of the host so a screen never names `window`
   * and a test can say where the checkout came back to.
   */
  abstract applicationOrigin(): string;

  abstract succeeded(notice: BillingSuccessNotice): void;

  abstract failed(failure: BillingFailureNotice): void;
}

const BillingHostContext = createContext<BillingHostPort | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const BillingHostProvider = BillingHostContext.Provider;

/**
 * The host this screen is mounted in. Missing means it was rendered outside
 * the frontend feature that owns it — a composition fault, not something a
 * screen can degrade around.
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
