/**
 * The Integrations family, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/settings/integrations`. The route table declares a
 * single `/settings/integrations` row and the loader registry a single
 * `pages/settings/integrations` key.
 *
 * WHY THIS PACKAGE. A key belongs to the family that owns its TRANSPORT. Both
 * calls are `github.*`, mounted out of `@langwatch/github-server`, and every
 * type the page renders is `@langwatch/github-contract`'s.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on, the settings chrome, the `organization:manage` guard,
 * and the host port that answers for the organization, the address, the failure
 * notice and the two departures to github.com.
 */

import type { ComponentType } from "react";

export type GithubScreenLoader = () => Promise<{ default: ComponentType }>;

export const githubScreens = {
  integrations: () => import("./ui/sections/integrations.screen.tsx"),
} as const satisfies Record<string, GithubScreenLoader>;

export type GithubScreenName = keyof typeof githubScreens;

export { INTEGRATIONS_PAGE_PERMISSION } from "./ui/sections/integrations.screen.tsx";
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
  type GithubFailureNotice,
  type GithubHostScope,
  type GithubRouteReading,
} from "./model/github-host.ts";
