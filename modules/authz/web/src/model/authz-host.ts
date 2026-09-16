// Screens ask application port; plan for Enterprise surfaces; no route reading.

import { createContext, useContext } from "react";

// Route and writes guard on organization:manage; prevents leaked organization data.
export const AUTHZ_MANAGE_PERMISSION = "organization:manage";

/** The organization these two pages are about. */
export type AuthzHostScope = {
  organizationId: string | undefined;
};

/**
 * The plan tier, and whether it has answered yet. `isLoading` is separate
 * from `isEnterprise`: collapsing "still asking" into "not Enterprise"
 * would show a paying customer a sales pitch for one round trip.
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
 * A failure, as a screen knows it. The raw `error` travels and never a
 * sentence the screen composed: a handled error's wire message is its code
 * slug, so `fallbackTitle` names the action that failed instead.
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
 * The host these screens are mounted in. Missing means a screen rendered
 * outside the frontend feature that owns it - a composition fault, not
 * something a screen can degrade around.
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
