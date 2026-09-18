/**
 * Integrations screen at `/settings/integrations`. The owning frontend must
 * mount the tRPC Provider, settings chrome, guards, and host port.
 */

export { githubApi } from "./behavior/github-api.ts";
export type { GithubApiMap } from "./behavior/github-api.ts";
export {
  GITHUB_ERROR_QUERY_KEY,
  GITHUB_INSTALL_RETURN,
  githubInstallAddress,
} from "./model/github-install-address.ts";
export {
  GithubHostApi,
  GithubHostProvider,
  INTEGRATIONS_PAGE_PERMISSION,
  type GithubFailureNotice,
  type GithubHostScope,
  type GithubRouteReading,
} from "./model/github-host.ts";
