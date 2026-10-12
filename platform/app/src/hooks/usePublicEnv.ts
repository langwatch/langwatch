import { api } from "../utils/api";

/**
 * How the deployment's public settings are cached in the browser.
 *
 * Kept briefly, never forever. They are fixed for the life of a server
 * process, but a tab outlives a restart: an operator who removes a sign-in
 * provider restarts the app, and a tab holding the old answer went on offering
 * "Connect Microsoft" against a provider the server no longer mounts. A short
 * stale time with a fresh ask on mount and on focus means a reload, or coming
 * back to the tab, shows the deployment as it is now, while the many
 * components reading this in one render still share one request.
 *
 * Spec: specs/identity/authentication-settings.feature
 */
export const PUBLIC_ENV_QUERY_OPTIONS = {
  staleTime: 30_000,
  refetchOnMount: true,
  refetchOnWindowFocus: true,
} as const;

export const usePublicEnv = () => {
  return api.publicEnv.useQuery({}, PUBLIC_ENV_QUERY_OPTIONS);
};
