/**
 * What the coding-agent activity tables ask of the application they are
 * mounted in.
 *
 * The sessions and pull-request tables read their own data and act on it —
 * they open a terminal replay, send a reader to the trace explorer, and offer
 * a GitHub install to whoever may accept it. None of those may reach a router,
 * a toast singleton or a session client from a feature-web package, so they
 * ask this port and the composing surface answers it.
 *
 * DELIBERATELY NARROWER than `PersonalWorkspaceHostPort`, `GatewayHostPort` and
 * `GovernanceHostPort`, which are the ports of whole page families. This is the
 * port of two tables: one permission question, the address, and the two
 * notices. A table mounted on a project page and the same table mounted on a
 * personal page are answering to different scopes, and neither scope is
 * anything this port has to know.
 */

import { createContext, useContext } from "react";

/** The path parameters and query string the surface was opened with. */
export type CodingAgentRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation, or a plain statement of what the data is. */
export type CodingAgentNotice = {
  title: string;
  description?: string;
  id?: string;
};

/** A failure, carrying the raw error so the host resolves the words. */
export type CodingAgentFailure = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

export abstract class CodingAgentActivityHostPort {
  /** Fails closed: an answer that has not arrived reads as no. */
  abstract hasPermission(permission: string): boolean;

  abstract route(): CodingAgentRouteReading;

  /** Replaces the whole query string; a key left out is a key removed. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string): void;

  abstract succeeded(notice: CodingAgentNotice): void;

  abstract failed(failure: CodingAgentFailure): void;
}

const CodingAgentActivityHostContext = createContext<CodingAgentActivityHostPort | undefined>(
  void 0,
);

/** Publishes the host to every activity table below it. */
export const CodingAgentActivityHostProvider = CodingAgentActivityHostContext.Provider;

/**
 * The surface this table is running in.
 *
 * Missing means the table was mounted outside a screen that answers for it,
 * which is a composition fault rather than something the table can degrade
 * around.
 */
export function useCodingAgentActivityHost(): CodingAgentActivityHostPort {
  const host = useContext(CodingAgentActivityHostContext);
  if (!host) {
    throw new Error(
      "No coding-agent activity host is mounted above this table; render it inside a screen that provides one.",
    );
  }
  return host;
}
