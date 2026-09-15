/**
 * Integrations screen at `/settings/integrations`. The owning frontend must
 * mount the tRPC Provider, settings chrome, guards, and host port.
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
