/**
 * What the license screen asks of its host application. isSaaS is a pair
 * (isSaaS() and isDeploymentSettled()) because a confirmed deployment may hide
 * the restart line; during resolution, showing it is harmless.
 */

import { createContext, useContext } from "react";

export type LicensingSuccessNotice = {
  title: string;
  description?: string;
};

/**
 * A failure, as the screen knows it. The raw `error` travels, never a
 * sentence the screen composed — words are resolved from `code` via the
 * host's presentation registry (#5984).
 */
export type LicensingFailureNotice = {
  error: unknown;
  fallbackTitle: string;
};

export abstract class LicensingHostApi {
  /** The organization the license is read and written against. */
  abstract organizationId(): string | undefined;

  /** Whether this deployment is the hosted product. Fail-safe: false. */
  abstract isSaaS(): boolean;

  /** Whether the answer above has arrived. */
  abstract isDeploymentSettled(): boolean;

  /**
   * Where an operator without a license goes to buy one: the deployment's
   * own Stripe link when it publishes one, undefined otherwise — so the
   * card falls back to the public pricing page instead of a dead link.
   */
  abstract licensePurchaseUrl(): string | undefined;

  /**
   * Drops every cached read: activating or removing a license moves the
   * ACTIVE PLAN, which half the application reads (navigation, feature
   * gates, limit copy) — not a page reload, which would tear off the notice.
   */
  abstract refreshPlanDerivedState(): void;

  abstract succeeded(notice: LicensingSuccessNotice): void;

  abstract failed(failure: LicensingFailureNotice): void;

  /** Whether the signed-in member may manage the organization. Fail-closed. */
  abstract canManageOrganization(): boolean;

  /** One failure as a sentence, its words resolved from its code (#5984). */
  abstract describeFailure(failure: LicensingFailureNotice): string;
}

const LicensingHostContext = createContext<LicensingHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const LicensingHostProvider = LicensingHostContext.Provider;

/**
 * The host this screen is mounted in. Missing means it was rendered outside
 * the frontend feature that owns it — a composition fault, not something a
 * screen can degrade around.
 */
export function useLicensingHost(): LicensingHostApi {
  const host = useContext(LicensingHostContext);
  if (!host) {
    throw new Error(
      "No licensing host is mounted above this screen; render it inside the licensing frontend feature.",
    );
  }
  return host;
}

// No page-level permission guard; enforcement is at the API level.
export const LICENSE_PAGE_PERMISSION = void 0;
