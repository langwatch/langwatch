// Two screens (authorize + mcpAuthorize) answer one question: what is this project granting? They
// share credential procedures with Settings API Keys so they can't be separate.

import type { ComponentType } from "react";

export type AuthorizeScreenLoader = () => Promise<{ default: ComponentType }>;

export const authorizeScreens = {
  authorize: () => import("./ui/sections/authorize-screen.tsx"),
  mcpAuthorize: () => import("./ui/sections/mcp-authorize-screen.tsx"),
} as const satisfies Record<string, AuthorizeScreenLoader>;

export type AuthorizeScreenName = keyof typeof authorizeScreens;

export { DISALLOWED_REDIRECT_SCHEMES, isAllowedRedirectScheme } from "./model/redirect-schemes.ts";
export {
  AuthorizeHostApi,
  AuthorizeHostProvider,
  type AuthorizeFailureNotice,
  type AuthorizeRouteReading,
  type AuthorizeScope,
  type AuthorizeSessionStatus,
  type AuthorizeSuccessNotice,
  type McpAuthorizeAnswer,
  type McpAuthorizeRequest,
} from "./model/authorize-host.ts";

/**
 * The tRPC Provider both handoff screens run on. It is the API Keys settings
 * screen's binding, deliberately: the two families share one cache rather than
 * standing a second client over the same procedures.
 */
export { apiKeyApi } from "./behavior/api-key-api.ts";
