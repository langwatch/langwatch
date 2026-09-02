/**
 * The Integrations family, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/settings/integrations`.
 *
 * THE RANKING ROW SAID TWO KEYS AND THERE IS ONE. The route table declares a
 * single `/settings/integrations` row and the loader registry a single
 * `pages/settings/integrations` key; nothing else in either names an
 * integration. The row's second key was a guess about a sibling that does not
 * exist — the fourth family in this programme whose key count was wrong, and
 * the second where the error was upward.
 *
 * WHY THIS PACKAGE. The credentials family's rule, read strictly: a key belongs
 * to the family that owns its TRANSPORT. Both calls are `github.*`, mounted out
 * of `@langwatch/github-server`, and every type the page renders is
 * `@langwatch/github-contract`'s. Transport and types agree, so there was
 * nothing to argue — and the package already existed, holding the connect popup
 * `platform/app`'s Langy card opens.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on, the settings chrome, the `organization:manage` guard,
 * and the host port that answers for the organization, the address, the failure
 * notice and the two departures to github.com.
 */

import type { ComponentType } from "react";

export type GithubScreenLoader = () => Promise<{ default: ComponentType }>;

export const githubScreens = {
  integrations: () => import("./integrations.screen"),
} as const satisfies Record<string, GithubScreenLoader>;

export type GithubScreenName = keyof typeof githubScreens;

export { INTEGRATIONS_PAGE_PERMISSION } from "./integrations.screen";
export { githubApi } from "../../behavior/github-api";
export type { GithubApiMap } from "../../behavior/github-api";
export {
  GITHUB_ERROR_QUERY_KEY,
  GITHUB_INSTALL_RETURN,
  githubInstallAddress,
} from "../../model/github-install-address";
export {
  GithubHostPort,
  GithubHostProvider,
  type GithubFailureNotice,
  type GithubHostScope,
  type GithubRouteReading,
} from "../../model/github-host";
