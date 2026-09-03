/**
 * The handoff family, as the browser application mounts it.
 *
 * TWO ADDRESSES, ONE QUESTION: what is this project granting, and to whom.
 *
 *   `/authorize`      → authorize, which hands a reader their project's API key
 *                       to paste into a terminal or a notebook.
 *   `/mcp/authorize`  → mcpAuthorize, the OAuth consent screen an MCP client
 *                       opens on its way to being granted that project's tools.
 *
 * They ship inside `@langwatch/api-key-web` rather than as a package of their
 * own because that is where the question already lives: the settings screen this
 * package serves mints and revokes the very credentials these two hand out, and
 * `/authorize` reads the same legacy project key the API Keys table renders, off
 * the same procedure under the same permission check. Splitting them would have
 * meant two packages asking `organization.getAll` for one project's key.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the host port — the project
 * scope, the session, the address, the two navigations plus the third-party
 * handoff, `revealProjectApiKey()`, the project switcher that IS the consent
 * control, the MCP exchange, the two notices and the clipboard. NEITHER SCREEN
 * TAKES A PAGE GUARD, and that is the platform pages' policy one for one:
 * `/authorize` refuses nothing (a reader without `project:update` sees an empty
 * key, which is the server's answer, not a refusal) and `/mcp/authorize` does its
 * own session redirect, which a permission guard would pre-empt.
 */

import type { ComponentType } from "react";

export type AuthorizeScreenLoader = () => Promise<{ default: ComponentType }>;

export const authorizeScreens = {
  authorize: () => import("./authorize.screen"),
  mcpAuthorize: () => import("./mcp-authorize.screen"),
} as const satisfies Record<string, AuthorizeScreenLoader>;

export type AuthorizeScreenName = keyof typeof authorizeScreens;

export { DISALLOWED_REDIRECT_SCHEMES, isAllowedRedirectScheme } from "../../model/redirect-schemes";
export {
  AuthorizeHostPort,
  AuthorizeHostProvider,
  type AuthorizeFailureNotice,
  type AuthorizeRouteReading,
  type AuthorizeScope,
  type AuthorizeSessionStatus,
  type AuthorizeSuccessNotice,
  type McpAuthorizeAnswer,
  type McpAuthorizeRequest,
} from "../../model/authorize-host";
