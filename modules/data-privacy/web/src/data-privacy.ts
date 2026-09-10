/**
 * The Data Privacy family, as the browser application mounts it. One screen,
 * one address (`/settings/data-privacy`), exposed as a LOADER so the rule
 * drawer and the audience picker stay out of the application's own chunk. The
 * owning frontend feature mounts the tRPC provider and the host port.
 */

import type { ComponentType } from "react";

export type DataPrivacyScreenLoader = () => Promise<{ default: ComponentType }>;

export const dataPrivacyScreens = {
  dataPrivacy: () => import("./ui/sections/data-privacy-screen.tsx"),
} as const satisfies Record<string, DataPrivacyScreenLoader>;

export type DataPrivacyScreenName = keyof typeof dataPrivacyScreens;

export {
  privacyRuleAddress,
  privacyRuleForAddress,
  PRIVACY_RULE_NEW_VALUE,
  PRIVACY_RULE_QUERY_KEY,
  PRIVACY_SCOPE_QUERY_KEY,
} from "./ui/sections/data-privacy-screen.tsx";
export { dataPrivacyApi } from "./behavior/data-privacy-api.ts";
export {
  DataPrivacyHostApi,
  DataPrivacyHostProvider,
  type PrivacyFailureNotice,
  type PrivacyHostScope,
  type PrivacyRouteReading,
  type PrivacySuccessNotice,
} from "./model/data-privacy-host.ts";
