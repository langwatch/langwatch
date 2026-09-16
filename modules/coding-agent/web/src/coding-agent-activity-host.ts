// Host port for activity tables: replay, trace, GitHub install; narrower
// than full-family ports; scope-agnostic.

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

export abstract class CodingAgentActivityHost {
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

const CodingAgentActivityHostContext = createContext<CodingAgentActivityHost | undefined>(
  void 0,
);

/** Publishes the host to every activity table below it. */
export const CodingAgentActivityHostProvider = CodingAgentActivityHostContext.Provider;

/**
 * The surface this table is running in. Missing means the table was mounted
 * outside a screen that answers for it — a composition fault, not something
 * the table can degrade around.
 */
export function useCodingAgentActivityHost(): CodingAgentActivityHost {
  const host = useContext(CodingAgentActivityHostContext);
  if (!host) {
    throw new Error(
      "No coding-agent activity host is mounted above this table; render it inside a screen that provides one.",
    );
  }
  return host;
}
