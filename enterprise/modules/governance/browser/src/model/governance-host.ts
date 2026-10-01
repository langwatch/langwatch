/** Port providing governance screens with auth, routing, toasts, and plan context. */

import { createContext, useContext } from "react";

/** The organization the governance section is about. */
export type GovernanceScope = {
  organizationId: string | null;
  projectId: string | null;
};

/** One organization as the section reads it: its own row plus its teams. */
export type GovernanceOrganization = {
  id: string;
  name: string;
  slug: string;
  teams: readonly GovernanceTeam[];
};

export type GovernanceTeam = {
  id: string;
  name: string;
  projects: readonly GovernanceProject[];
};

export type GovernanceProject = {
  id: string;
  name: string;
  slug: string;
};

/** The path parameters and query string the screen was opened with. */
export type GovernanceRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type GovernanceSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it — the raw `error` travels, never a
 * screen-composed sentence, since the wire message of a handled error is
 * its code slug. `fallbackTitle` names the action that failed.
 */
export type GovernanceFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/** The shape of the deployment, as the install instructions read it. */
export type GovernanceDeployment = {
  isSaas: boolean;
  appBaseUrl: string;
};

/** Which plan the organization is on, for the surfaces that are gated on it. */
export type GovernancePlan = {
  isEnterprise: boolean;
  isLoading: boolean;
};

/** The reader, as much of them as a greeting needs. */
export type GovernanceActor = {
  id: string;
  name: string | null;
  email: string | null;
};

/**
 * The one thing a screen is handed — methods rather than loose functions,
 * so the adapter is a class the frontend feature constructs once, and a
 * test double is an obvious object literal.
 */
export abstract class GovernanceHostApi {
  /** The organization and project this page is about. */
  abstract scope(): GovernanceScope;

  /** Every organization the reader can reach, for the pages that name teams. */
  abstract organizations(): readonly GovernanceOrganization[];

  /** The organization the section is scoped to, resolved from the scope. */
  abstract organization(): GovernanceOrganization | undefined;

  /**
   * Who is reading, when the shell knows. `null` covers both "not signed in"
   * and "not answered yet", because a greeting is the only caller and it has
   * the same anonymous fallback for either.
   */
  abstract currentUser(): GovernanceActor | null;

  /** Fails closed: an answer that has not arrived reads as no. */
  abstract hasPermission(permission: string): boolean;

  /** Fails closed the same way. */
  abstract isFeatureEnabled(flag: string): boolean;

  /** On, off, or `undefined` while the flag has not answered yet. */
  abstract featureFlag(flag: string): boolean | undefined;

  /** Whether the session's grants have arrived, so a "no" is a real no. */
  abstract isSettled(): boolean;

  abstract plan(): GovernancePlan;

  /** What kind of deployment this is, for copy that differs on self-hosted. */
  abstract deployment(): GovernanceDeployment;

  abstract route(): GovernanceRouteReading;

  /** Replaces the whole query string; a key left out is a key removed. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string): void;

  abstract succeeded(notice: GovernanceSuccessNotice): void;

  abstract failed(failure: GovernanceFailureNotice): void;
}

const GovernanceHostContext = createContext<GovernanceHostApi | undefined>(void 0);

/** Publishes the host to every governance screen below it. */
export const GovernanceHostProvider = GovernanceHostContext.Provider;

/**
 * The application this screen is running in. Missing means it was mounted
 * outside its frontend feature — a composition fault, not something the
 * screen can degrade around.
 */
export function useGovernanceHost(): GovernanceHostApi {
  const host = useContext(GovernanceHostContext);
  if (!host) {
    throw new Error(
      "No governance host is mounted above this screen; render it inside the governance frontend feature.",
    );
  }
  return host;
}
