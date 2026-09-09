/**
 * What the Data Retention screen asks of the application it is mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package, and reaching for any of them is also what would make this screen
 * untestable outside a running application. It asks this port instead, and the
 * frontend feature that owns it — `apps/ui/src/features/data-retention` —
 * answers it by adapting the browser capabilities the application resolves.
 *
 * THE SEVENTH FAMILY TO DECLARE THIS SHAPE, after governance, gateway, the
 * personal workspace, automations, ops and agents. Each of those recorded that
 * a repeat is the signal to promote it into one place, and each left it, for
 * the same reason: promotion changes packages a page-family move does not own.
 * Recorded again in `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * WHAT THIS FAMILY ASKS THAT THE OTHERS DID NOT is `isPlatformAdmin()`. Only a
 * platform administrator may turn retention OFF, and the route enforces that
 * independently; the flag decides nothing but whether the drawer offers the
 * "keep forever" option at all. It is a SEPARATE answer from `hasPermission`
 * on purpose — platform administration is an email allowlist rather than an
 * organization grant, so folding it into a permission would widen it.
 */

import { createContext, useContext } from "react";

/** The organization, team and project the address is about. */
export type RetentionHostScope = {
  organizationId: string | undefined;
  teamId: string | undefined;
  projectId: string | undefined;
};

/**
 * The organization, teams and projects the reader can SEE, for the scope filter.
 *
 * Deliberately not the snapshot's `available`, which is the RBAC-filtered set
 * the reader may WRITE to: narrowing the filter to writable scopes would hide
 * rows a project-only reader is allowed to read. The application derives this
 * from the organization graph it already holds.
 *
 * Declared structurally rather than as `AvailableScopes` from
 * `@langwatch/authz-web`: naming that package here would put a second
 * `ui-screen-closure` finding on the family for a shape three fields wide.
 */
export type RetentionAvailableScopes = {
  organization: { id: string; name: string } | null;
  teams: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; teamId?: string | null }>;
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
export abstract class DataRetentionHostPort {
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

const DataRetentionHostContext = createContext<DataRetentionHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const DataRetentionHostProvider = DataRetentionHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useDataRetentionHost(): DataRetentionHostPort {
  const host = useContext(DataRetentionHostContext);
  if (!host) {
    throw new Error(
      "No Data Retention host is mounted above this screen; render it inside the data-retention frontend feature.",
    );
  }
  return host;
}
