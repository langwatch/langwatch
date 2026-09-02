/**
 * The API Key family, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes for each
 * page is a LOADER rather than a component, because between them these two
 * screens drag two drawers, a Shiki-backed code block and the whole permission
 * catalogue behind them, and none of that belongs in the chunk that renders the
 * rest of the application.
 *
 * TWO SCREENS, THREE ADDRESSES — and the third is why this family ships as one
 * package. `/cli/auth` imports the permission ceiling and the category picker
 * that Settings > API Keys owns, so the two could not move separately: the CLI
 * screen would have kept importing files the settings move deletes.
 *
 *   `/settings/api-keys`  → apiKeys, framed by the settings chrome
 *   `/settings/secrets`   → NOT here. `secrets.*` is `@langwatch/secret-server`'s
 *                           transport and every type on that page is
 *                           `@langwatch/secret-contract`'s, so it went to
 *                           `@langwatch/secret-web` rather than riding along.
 *   `/cli/auth`           → cliAuth, which frames ITSELF: it is the page a
 *                           browser opened by `langwatch login` lands on, with
 *                           no product shell around it.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC Provider
 * this package's hooks run on, and the host port that answers for the scope, the
 * grants, the visible scopes, the organization graph, the session, the address,
 * the two notices, the clipboard, the lead-source stamp, the one `platform/app`
 * drawer these screens address rather than mount — and the three CLI device-flow
 * REST calls, which are a transport and belong to the application.
 */

import type { ComponentType } from "react";

export type ApiKeyScreenLoader = () => Promise<{ default: ComponentType }>;

export const apiKeyScreens = {
  apiKeys: () => import("./api-keys.screen"),
  cliAuth: () => import("./cli-auth.screen"),
} as const satisfies Record<string, ApiKeyScreenLoader>;

export type ApiKeyScreenName = keyof typeof apiKeyScreens;

export { API_KEY_SCOPE_QUERY_KEY, PROJECT_KEY_ROTATE_PERMISSION } from "./api-keys.screen";
export { CLI_LEAD_SOURCE } from "./cli-auth.screen";
export { apiKeyApi } from "../../behavior/api-key-api";
export {
  ApiKeyHostPort,
  ApiKeyHostProvider,
  type ApiKeyActor,
  type ApiKeyAvailableScopes,
  type ApiKeyFailureNotice,
  type ApiKeyHostScope,
  type ApiKeyOrganization,
  type ApiKeyOrganizationProject,
  type ApiKeyOrganizationTeam,
  type ApiKeyPlatformDrawer,
  type ApiKeyRouteReading,
  type ApiKeySessionStatus,
  type ApiKeySuccessNotice,
  type CliCredentialType,
  type CliDeviceActionResult,
  type CliDeviceApproval,
  type CliDeviceCodeLookup,
} from "../../model/api-key-host";
