/**
 * Host port for the Integrations screen: application capabilities with external
 * navigation support for connecting/disconnecting on GitHub.
 */

import { createContext, useContext } from "react";

/** The organization whose connection this page is about. */
export type GithubHostScope = {
  organizationId: string | undefined;
};

/**
 * A failure, as the screen knows it. The raw `error` travels and never a
 * sentence the screen composed: the wire message of a handled error IS its code
 * slug since #5984.
 */
export type GithubFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
  id?: string;
};

export type GithubRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** The one thing a screen is handed. */
export abstract class GithubHostApi {
  abstract scope(): GithubHostScope;

  abstract route(): GithubRouteReading;

  /**
   * Rewrites the query string in place.
   *
   * The install round-trip lands back here with `?githubError=…` when GitHub
   * refused; the screen reports it once and then drops the parameter, so a
   * reload does not report it again.
   */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  /**
   * Leaves this application for an address it does not serve, in this tab.
   *
   * The install entry point is built by the SERVER and handed back on the
   * connection status, so the App slug and the shape of the flow stay off the
   * client; the screen only appends the mode and the return address.
   */
  abstract leaveTo(url: string): void;

  /** Opens an address this application does not serve in a new tab. */
  abstract openExternal(url: string): void;

  abstract failed(failure: GithubFailureNotice): void;
}

const GithubHostContext = createContext<GithubHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const GithubHostProvider = GithubHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useGithubHost(): GithubHostApi {
  const host = useContext(GithubHostContext);
  if (!host) {
    throw new Error(
      "No GitHub host is mounted above this screen; render it inside the GitHub frontend feature.",
    );
  }
  return host;
}
