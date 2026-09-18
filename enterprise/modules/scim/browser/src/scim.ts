// The SCIM family as the browser application mounts it: one screen at /settings/scim.
// Owning frontend must mount tRPC provider, host port, base URL, and notices.

import type { ComponentType } from "react";

export type ScimScreenLoader = () => Promise<{ default: ComponentType }>;

export const scimScreens = {
  scim: () => import("./ui/sections/scim.screen.tsx"),
} as const satisfies Record<string, ScimScreenLoader>;

export type ScimScreenName = keyof typeof scimScreens;

export { scimApi, type ScimApiMap, type ScimTokenRow } from "./behavior/scim-api.ts";
export {
  SCIM_PAGE_PERMISSION,
  ScimHostApi,
  ScimHostProvider,
  type ScimFailureNotice,
  type ScimSuccessNotice,
} from "./model/scim-host.ts";
