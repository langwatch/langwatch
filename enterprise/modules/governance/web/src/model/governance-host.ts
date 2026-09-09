/**
 * What the governance screens ask of the application they are mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package, and reaching for any of them is also what would make these screens
 * untestable outside a running application. They ask this port instead, and the
 * frontend feature that owns them — `apps/ui/src/features/governance` — answers
 * it by adapting the browser capabilities the application already resolves.
 *
 * It lives in `model` because it is a package-wide portable value: types plus
 * the React context they travel in, depending on nothing but React. Every layer
 * above may read it, which is the point — a chip deep in a table needs the same
 * navigate the screen does.
 *
 * The port is deliberately narrow. It answers four questions the browser owns
 * (who is here, where they are, what they may do, what is switched on), moves
 * the address bar, reads it, tells the user how an action turned out, and says
 * which plan the organization is on. Anything wider belongs to the screens.
 */

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
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: since the
 * wire message of a handled error is its code slug, a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
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

/**
 * The one thing a screen is handed.
 *
 * Methods rather than an object of loose functions, so the adapter is a class
 * the frontend feature constructs once and a test double is an obvious object
 * literal.
 */
export abstract class GovernanceHostPort {
  /** The organization and project this page is about. */
  abstract scope(): GovernanceScope;

  /** Every organization the reader can reach, for the pages that name teams. */
  abstract organizations(): readonly GovernanceOrganization[];

  /** The organization the section is scoped to, resolved from the scope. */
  abstract organization(): GovernanceOrganization | undefined;

  /** Fails closed: an answer that has not arrived reads as no. */
  abstract hasPermission(permission: string): boolean;

  /** Fails closed the same way. */
  abstract isFeatureEnabled(flag: string): boolean;

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

const GovernanceHostContext = createContext<GovernanceHostPort | undefined>(void 0);

/** Publishes the host to every governance screen below it. */
export const GovernanceHostProvider = GovernanceHostContext.Provider;

/**
 * The application this screen is running in.
 *
 * Missing means the screen was mounted outside its frontend feature, which is a
 * composition fault rather than something the screen can degrade around.
 */
export function useGovernanceHost(): GovernanceHostPort {
  const host = useContext(GovernanceHostContext);
  if (!host) {
    throw new Error(
      "No governance host is mounted above this screen; render it inside the governance frontend feature.",
    );
  }
  return host;
}
