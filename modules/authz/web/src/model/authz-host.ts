// Screens ask application port; plan for Enterprise surfaces; no route reading.

import { createContext, useContext } from "react";

// Route and writes guard on organization:manage; prevents leaked organization data.
export const AUTHZ_MANAGE_PERMISSION = "organization:manage";

/** The organization these two pages are about. */
export type AuthzHostScope = {
  organizationId: string | undefined;
};

/**
 * The plan tier, and whether it has answered yet.
 *
 * `isLoading` is separate from `isEnterprise` because the three states are
 * genuinely three: still asking, Enterprise, and not Enterprise. Collapsing the
 * first into the third is what would show a paying customer a sales pitch for
 * the length of one round trip.
 */
export type AuthzPlanReading = {
  isEnterprise: boolean;
  isLoading: boolean;
};

/** A short confirmation of something the reader just did. */
export type AuthzSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as a screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error is its code slug, so a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type AuthzFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/** The one thing the screens are handed. */
export abstract class AuthzHostPort {
  /** The organization these pages are about. */
  abstract scope(): AuthzHostScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  /** The plan tier that decides whether these pages are the feature or the pitch. */
  abstract plan(): AuthzPlanReading;

  abstract succeeded(notice: AuthzSuccessNotice): void;

  abstract failed(failure: AuthzFailureNotice): void;
}

const AuthzHostContext = createContext<AuthzHostPort | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const AuthzHostProvider = AuthzHostContext.Provider;

/**
 * The host these screens are mounted in.
 *
 * Missing means a screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useAuthzHost(): AuthzHostPort {
  const host = useContext(AuthzHostContext);
  if (!host) {
    throw new Error(
      "No AuthZ host is mounted above this screen; render it inside the authz frontend feature.",
    );
  }
  return host;
}
