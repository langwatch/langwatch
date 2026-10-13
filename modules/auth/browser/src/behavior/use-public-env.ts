/**
 * Deployment static config injected into HTML; reads from host port via useAuthHost
 */

import type { AuthPublicEnvironment } from "@langwatch/auth-contract";

import { useAuthHost } from "../model/auth-host.ts";

type StaticEnvironmentResult = {
  data: AuthPublicEnvironment;
  isLoading: false;
};

/** Resolved by the shell, so never loading. */
export function usePublicEnv(): StaticEnvironmentResult {
  return { data: useAuthHost().publicEnvironment(), isLoading: false };
}
