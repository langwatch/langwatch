// Two screens (apiKeys + cliAuth) share permission picker so they can't be separate. Exports
// LOADERs not components to keep heavy deps (Shiki, permissions) out of main chunk.

import type { ComponentType } from "react";

export type ApiKeyScreenLoader = () => Promise<{ default: ComponentType }>;

export const apiKeyScreens = {
  apiKeys: () => import("./ui/sections/api-keys-screen.tsx"),
  cliAuth: () => import("./ui/sections/cli-auth-screen.tsx"),
} as const satisfies Record<string, ApiKeyScreenLoader>;

export type ApiKeyScreenName = keyof typeof apiKeyScreens;

export {
  API_KEY_SCOPE_QUERY_KEY,
  PROJECT_KEY_ROTATE_PERMISSION,
} from "./ui/sections/api-keys-screen.tsx";
export { CLI_LEAD_SOURCE } from "./ui/sections/cli-auth-screen.tsx";
export { apiKeyApi } from "./behavior/api-key-api.ts";
export {
  ApiKeyHostApi,
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
} from "./model/api-key-host.ts";
