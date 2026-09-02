/**
 * What the navigation feature asks of the application it is mounted in.
 *
 * Everything the landing redirect and the project switcher used to read off
 * `platform/app` — the organization graph, the signed-in user, the grants, the
 * feature flags and the address bar — arrives through this one declaration, so
 * the package names none of that application's modules.
 *
 * The port is deliberately SYNCHRONOUS and fail-closed, the same contract
 * `apps/ui`'s session capability already keeps: a grant or a flag that has not
 * answered yet reads as "not yet", never as "yes". `isLoading()` is what tells
 * the redirect to wait rather than to decide against a half-read workspace.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { LastVisitedHomeKind } from "./resolve-home-destination";

/** A project as the switcher and the landing redirect need to know it. */
export type NavigationProject = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean | null;
};

/** A team, with the projects the switcher offers under it. */
export type NavigationTeam = {
  id: string;
  name: string;
  isPersonal?: boolean | null;
  /** Who may open the team. Absent when the application did not read it. */
  members?: { userId: string }[];
  projects: NavigationProject[];
};

export type NavigationOrganization = {
  id: string;
  name: string;
  teams: NavigationTeam[];
};

/**
 * A flag answer, tri-state exactly as the session capability answers it:
 * `isLoading` is what keeps a landing decision from resolving against a flag
 * that has not come back.
 */
export type NavigationFlagReading = {
  enabled: boolean;
  isLoading: boolean;
};

export abstract class NavigationHostPort {
  /** Every organization the reader belongs to; empty is a real answer. */
  abstract organizations(): NavigationOrganization[];

  /** The organization the current address is about, when there is one. */
  abstract organization(): NavigationOrganization | undefined;

  /** The project the current address is about, when there is one. */
  abstract project(): NavigationProject | undefined;

  /** Whether the workspace reads above are still arriving. */
  abstract isLoading(): boolean;

  /** The signed-in user's id, absent until the session answers. */
  abstract currentUserId(): string | undefined;

  /**
   * The reader's role in the resolved organization, in the vocabulary the
   * application's own graph carries. Only compared for equality here, which is
   * why the port takes a string rather than restating a Prisma enum.
   */
  abstract organizationRole(): string | undefined;

  /**
   * Teams the reader may open, in the host's ambient preference order.
   *
   * "May open" and "which one is ambient" are the application's own scope
   * policy — the same test its chrome applies before rendering a page — so the
   * host answers with the list already filtered and ordered rather than handing
   * the raw graph over with the rules attached.
   */
  abstract openableTeams(): readonly NavigationTeam[];

  /**
   * The project slug this device last had open, or "".
   *
   * The application shell's own scope memory, not a key this package writes.
   */
  abstract rememberedProjectSlug(): string;

  /**
   * Which KIND of home the reader last sat on: "project", "personal", or ""
   * before either. Written by the application on each visit and read here, so
   * `/` sticks both ways.
   */
  abstract lastVisitedHomeKind(): LastVisitedHomeKind;

  /** Fail-closed grant check. */
  abstract hasPermission(permission: string): boolean;

  /** Fail-closed flag check, with the pending state kept. */
  abstract featureFlag(flag: string): NavigationFlagReading;

  /**
   * What the application shows while a navigation decision is still being made.
   *
   * The wait belongs to the host: it is that application's chrome, its logo and
   * its motion budget, and a package may not reach for any of the three. The
   * same shape the organization family's `projectSwitcher()` established.
   */
  abstract waiting(): ReactNode;

  /** Replaces the current address — the landing redirect's only navigation. */
  abstract replace(to: string): void;

  /** Pushes an address — what picking a project in the switcher does. */
  abstract navigate(to: string): void;
}

const NavigationHostContext = createContext<NavigationHostPort | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const NavigationHostProvider = NavigationHostContext.Provider;

/**
 * The host this feature is mounted in.
 *
 * Throws rather than degrading: a navigation surface with no host cannot pick
 * a destination, and a silent default would send the reader somewhere wrong.
 */
export function useNavigationHost(): NavigationHostPort {
  const host = useContext(NavigationHostContext);
  if (!host) {
    throw new Error("No NavigationHostPort in context. Mount NavigationHostProvider above.");
  }
  return host;
}

/**
 * The host, or nothing.
 *
 * For the one control that is handed ACROSS a seam rather than rendered where
 * it was built: the project switcher travels to a screen as a `ReactNode`, and
 * a screen mounted somewhere the chrome does not reach would otherwise crash on
 * a header decoration. Rendering no switcher is the honest answer there — the
 * same answer the port gave before there was one.
 */
export function useOptionalNavigationHost(): NavigationHostPort | undefined {
  return useContext(NavigationHostContext);
}
