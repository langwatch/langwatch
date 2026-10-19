/**
 * Front-door host port: deployment config and route, not identity wire
 */

import type {
  AuthFailureNotice,
  AuthPublicEnvironment,
  AuthRouteReading,
} from "@langwatch/auth-contract";
import { createContext, useContext } from "react";

/** The one thing a front-door screen is handed. */
export abstract class AuthHostApi {
  /** The deployment's public configuration. */
  abstract publicEnvironment(): AuthPublicEnvironment;

  /** Where this document is, and what it was opened with. */
  abstract route(): AuthRouteReading;

  /**
   * Reports failure to reader; second channel for app registry and trace id to reach front door
   */
  abstract failed(failure: AuthFailureNotice): void;
}

const AuthHostContext = createContext<AuthHostApi | null>(null);

export const AuthHostProvider = AuthHostContext.Provider;

/** The composition never mounted a host above a front-door screen. */
export class AuthHostUnavailableError extends Error {
  constructor() {
    super(
      "No AuthHostApi is mounted above this screen. " +
        "Wrap it in <AuthHostProvider value={host}>.",
    );
    this.name = "AuthHostUnavailableError";
  }
}

/** The host this screen is mounted in. Throws rather than guessing. */
export function useAuthHost(): AuthHostApi {
  const host = useContext(AuthHostContext);
  if (!host) throw new AuthHostUnavailableError();
  return host;
}

/**
 * The host, or nothing — for modules that have a correct answer without one:
 * the error alert degrades to the generic line, the fine print to the
 * built-in legal links, so a fragment test needn't compose a whole app.
 */
export function useOptionalAuthHost(): AuthHostApi | null {
  return useContext(AuthHostContext);
}
