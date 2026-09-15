/**
 * Port for what the Data Retention screen needs from its host application
 * (router, toast, session). See {@link dev/docs/plans/ui-family-move-manifests.md}
 * and {@link ADR-004}.
 */

import { createContext, useContext } from "react";

/** The organization, team and project the address is about. */
export type RetentionHostScope = {
  organizationId: string | undefined;
  teamId: string | undefined;
  projectId: string | undefined;
};

/**
 * Scopes the reader can see (not RBAC-filtered writable scopes) for the scope
 * filter. Declared structurally to avoid importing authz-web.
 */
export type RetentionAvailableScopes = {
  organization: { id: string; name: string } | null;
  teams: { id: string; name: string }[];
  projects: { id: string; name: string; teamId?: string | null }[];
};

/** The path parameters and query string the screen was opened with. */
export type RetentionRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type RetentionSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error is its code slug, so a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type RetentionFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/** The one thing the screen is handed. */
export abstract class DataRetentionHostApi {
  /** The organization, team and project this page is about. */
  abstract scope(): RetentionHostScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  /** Every scope the reader can see, which is what the scope filter offers. */
  abstract availableScopes(): RetentionAvailableScopes;

  /**
   * Whether the reader administers the PLATFORM, not an organization.
   *
   * Decides only whether the drawer offers "no retention (keep forever)". The
   * mutation authorizes the capability itself, so a stale `true` here can widen
   * the menu and not the outcome.
   */
  abstract isPlatformAdmin(): boolean;

  /** Whether the organization's plan is the enterprise (or self-hosted) tier. */
  abstract isEnterprise(): boolean;

  abstract route(): RetentionRouteReading;

  /** The whole next query string, so a screen can remove a key as well as set one. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract succeeded(notice: RetentionSuccessNotice): void;

  abstract failed(failure: RetentionFailureNotice): void;
}

const DataRetentionHostContext = createContext<DataRetentionHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const DataRetentionHostProvider = DataRetentionHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useDataRetentionHost(): DataRetentionHostApi {
  const host = useContext(DataRetentionHostContext);
  if (!host) {
    throw new Error(
      "No Data Retention host is mounted above this screen; render it inside the data-retention frontend feature.",
    );
  }
  return host;
}
