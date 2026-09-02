/**
 * What the organization settings screens ask of the application they are
 * mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package. It asks this port instead, and the frontend feature that owns it —
 * `apps/ui/src/features/organization` — answers it by adapting the browser
 * capabilities the application resolves.
 *
 * THE THIRTEENTH HOST PORT OF THE SAME SHAPE. Deferred again, for the same
 * reason every family before recorded: promoting the shape changes packages a
 * page move does not own, and doing it inside a page-family move would hide it.
 *
 * WHAT THIS ONE ASKS THAT NO OTHER DID is `download`. The audit trail's CSV
 * export is the one place in this family where the screen has to hand the
 * reader a FILE, and a screen may not synthesise an anchor, mint an object URL
 * or click either. So the split is the S6 one applied to a save rather than to
 * a wire: WHAT the file contains is decided in this package and pinned here
 * (`model/audit-log-export.ts`), and HOW it reaches the disk is the
 * application's, pinned in `apps/ui/tests/ui-file-download.unit.test.ts`.
 */

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/** The organization and project the current page is about. */
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
};

/** One team, as the filter dropdown groups projects under it. */
export type OrganizationTeamReading = {
  id: string;
  name: string;
  projects: readonly OrganizationProjectReading[];
};

/** The organization graph, as much of it as this family reads. */
export type OrganizationReading = {
  id: string;
  name: string;
  teams: readonly OrganizationTeamReading[];
};

/** The path parameters and query string the screen was opened with. */
export type OrganizationRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error is its code slug, so a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed.
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

/** The one thing a screen is handed. */
export abstract class OrganizationHostPort {
  /** The organization and project this page is about. */
  abstract scope(): OrganizationScope;

  /** The organization the reader is standing in, resolved from the scope. */
  abstract organization(): OrganizationReading | undefined;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  abstract route(): OrganizationRouteReading;

  /** Replaces the whole query string; a key left out is a key removed. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  /**
   * Offers the reader a way to change which project they are looking at, or
   * `null` when the application has no switcher to offer.
   *
   * The platform page put `DashboardLayout`'s `ProjectSelector` in its header.
   * That component reaches the organization graph, the router and the shell's
   * own scope memory, none of which a screen may name — so what travels is the
   * ABILITY, and the application supplies the control.
   */
  abstract projectSwitcher(): ReactNode | null;

  /** Moves the address bar, for the back-link out of a gateway deep-link. */
  abstract navigate(to: string): void;

  /**
   * Hands the reader a file.
   *
   * The one browser ability this family needs that is neither navigation nor a
   * notice. `platform/app` did it inline — mint an object URL, append an
   * anchor, click it, revoke — which is four browser globals a screen may not
   * name and, more to the point, four things nothing could assert about.
   */
  abstract download(file: OrganizationDownload): void;

  abstract failed(failure: OrganizationFailureNotice): void;
}

const OrganizationHostContext = createContext<OrganizationHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const OrganizationHostProvider = OrganizationHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useOrganizationHost(): OrganizationHostPort {
  const host = useContext(OrganizationHostContext);
  if (!host) {
    throw new Error(
      "No organization host is mounted above this screen; render it inside the organization frontend feature.",
    );
  }
  return host;
}
