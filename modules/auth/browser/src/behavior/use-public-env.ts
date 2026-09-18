/**
 * Deployment static config injected into HTML; reads from host port via useAuthHost
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
