/**
 * The deployment, as a front-door screen reads it.
 *
 * Wholly the STATIC half now: the shell already resolved it and injected it
 * into the HTML, so this reads off the host port
 * (`@langwatch/ui/public-config` is where the application reads it, and this
 * package may not import the application) rather than a round trip. There
 * used to be a second, query-backed hook for the sign-in provider name and
 * the operator-sidebar flag; the provider name joined the shell config and
 * the sidebar flag had no live reader left, so the query is gone.
 */

import { useAuthHost, type AuthPublicEnvironment } from "../model/auth-host.ts";

type StaticEnvironmentResult = {
  data: AuthPublicEnvironment;
  isLoading: false;
};

/** Resolved by the shell, so never loading. */
export function usePublicEnv(): StaticEnvironmentResult {
  return { data: useAuthHost().publicEnvironment(), isLoading: false };
}
