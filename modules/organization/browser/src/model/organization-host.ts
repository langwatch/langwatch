/** Host port for organization screens: sealed imports (ui, router, session) routed here. */

import type { UiAuthenticationOverviewCardProps } from "@langwatch/browser-host/declarations";
import { createContext, useContext } from "react";
import type { ComponentType, ReactNode } from "react";

/** The organization and project the current page is about. */
/** Who is signed in, as the members table and the team form need them. */
export type OrganizationActor = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

/** A short confirmation of something the administrator just did. */
export type OrganizationSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

export type OrganizationScope = {
  organizationId: string | undefined;
  projectId: string | undefined;
  /** The project's slug, which the gateway deep-link's back-link is built from. */
  projectSlug: string | undefined;
};

/** One project, as the filter dropdown and the Project column read it. */
export type OrganizationProjectReading = {
  id: string;
  name: string;
  slug: string;
};

/** One team, as the filter dropdown groups projects under it. */
export type OrganizationTeamReading = {
  id: string;
  name: string;
  slug: string;
  projects: OrganizationProjectReading[];
};

/** The organization graph, as much of it as this family reads. */
export type OrganizationReading = {
  id: string;
  name: string;
  teams: OrganizationTeamReading[];
};

/** The path parameters and query string the screen was opened with. */
export type OrganizationRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/**
 * A failure, as the screen knows it. The raw `error` travels, never a
 * sentence the screen composed — a handled error's wire message is its code
 * slug, so home-written copy would print the slug at the customer.
 */
export type OrganizationFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
  id?: string;
};

/** A file the reader asked for, ready to be handed to them. */
export type OrganizationDownload = {
  /** The name the file lands under. */
  fileName: string;
  /** The bytes, already rendered. */
  contents: string;
  /** What the bytes are, so the browser labels the save correctly. */
  mediaType: string;
};

/** What a peer's card on the Authentication overview is handed. */
/** A card another module declares for the Authentication overview (sso, scim). */
export type AuthenticationOverviewCard = {
  key: string;
  Card: ComponentType<UiAuthenticationOverviewCardProps>;
};

/** The one thing a screen is handed. */
export abstract class OrganizationHostApi {
  /** The organization and project this page is about. */
  abstract scope(): OrganizationScope;

  /** The organization the reader is standing in, resolved from the scope. */
  abstract organization(): OrganizationReading | undefined;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  /** Permission check at organization scope, not page scope. */
  abstract hasOrganizationPermission(permission: string): boolean;

  /** Who is signed in, or undefined before the session resolves. */
  abstract currentUser(): OrganizationActor | undefined;

  /**
   * The project in scope, or undefined when the address names none. The teams
   * page reads one thing off it: whether a row is the project the reader is
   * currently inside — the one project it refuses to offer a delete for.
   */
  abstract activeProject(): OrganizationProjectReading | undefined;

  /**
   * Whether the organization is on the Enterprise plan — a PAIR with
   * `isPlanLoading`, since still-arriving is a third state. Collapsing
   * "not yet" into "no" pitches an upgrade at a customer who already bought it.
   */
  abstract isEnterprise(): boolean;

  abstract isPlanLoading(): boolean;

  /**
   * Whether this deployment can send email. Without it, the members page
   * offers a copyable link rather than pretending a message went out.
   * Fail-safe is FALSE: a false positive costs a click, a false negative loses the invitation.
   */
  abstract hasEmailProvider(): boolean;

  /** Whether a feature flag is on. Fail-closed while it is still arriving. */
  abstract isFeatureEnabled(flag: string): boolean;

  /** Opens one of the application's overlays, by the name its address uses. */
  abstract openOverlay(name: string, props?: Record<string, unknown>): void;

  /** Closes whatever overlay is open. */
  abstract closeOverlay(): void;

  abstract succeeded(notice: OrganizationSuccessNotice): void;

  abstract route(): OrganizationRouteReading;

  /** Replaces the whole query string; a key left out is a key removed. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  /** Project switcher control, or null if unavailable. */
  abstract projectSwitcher(): ReactNode | null;

  /** Moves the address bar, for the back-link out of a gateway deep-link. */
  abstract navigate(to: string): void;

  /**
   * Hands the reader a file — the one browser ability this family needs that
   * is neither navigation nor a notice. `platform/app` did it inline (object
   * URL, anchor, click, revoke): four globals a screen may not name.
   */
  abstract download(file: OrganizationDownload): void;

  /** Ends the session: the one way out offered to somebody waiting on an administrator. */
  abstract signOut(): void;

  /**
   * How people sign in and how accounts arrive: the cards sso and scim declare
   * through `withCapabilities`, in the order the overview draws them.
   */
  abstract authenticationOverviewCards(): readonly AuthenticationOverviewCard[];

  abstract failed(failure: OrganizationFailureNotice): void;
}

const OrganizationHostContext = createContext<OrganizationHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const OrganizationHostProvider = OrganizationHostContext.Provider;

/**
 * The host this screen is mounted in. Missing means the screen was rendered
 * outside the frontend feature that owns it — a composition fault, not
 * something a screen can degrade around.
 */
export function useOrganizationHost(): OrganizationHostApi {
  const host = useContext(OrganizationHostContext);
  if (!host) {
    throw new Error(
      "No organization host is mounted above this screen; render it inside the organization frontend feature.",
    );
  }
  return host;
}

/**
 * The grant the page carries. `organization:manage` one for one with the platform page's
 * `withPermissionGuard`.
 */
export const AUDIT_LOG_PAGE_PERMISSION = "organization:manage";

/** The Authentication pages read on `sso:view`; changing a policy needs more. */
export const AUTHENTICATION_PAGE_PERMISSION = "sso:view";

/** The grant the platform page asked for, unchanged. */
export const GROUPS_PAGE_PERMISSION = "organization:manage";

/** The grant the platform page asked for, unchanged. */
export const MEMBERS_PAGE_PERMISSION = "organization:manage";

/** The grant the platform page asked for, unchanged. */
export const TEAMS_PAGE_PERMISSION = "organization:manage";

/** The grant the platform page asked for, unchanged. */
export const TEAM_DETAIL_PAGE_PERMISSION = "team:view";
