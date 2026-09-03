/**
 * The Data Privacy family, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes for the
 * page is a LOADER rather than a component, because the screen drags the rule
 * drawer, the audience picker and the effective-policy table behind it and none
 * of that belongs in the chunk that renders the rest of the application.
 *
 * ONE SCREEN, ONE ADDRESS: `/settings/data-privacy`.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC
 * Provider this package's hooks run on, and the host port that answers for the
 * scope, the address and the two notices.
 */

import type { ComponentType } from "react";

export type DataPrivacyScreenLoader = () => Promise<{ default: ComponentType }>;

export const dataPrivacyScreens = {
  dataPrivacy: () => import("./data-privacy.screen"),
} as const satisfies Record<string, DataPrivacyScreenLoader>;

export type DataPrivacyScreenName = keyof typeof dataPrivacyScreens;

export {
  privacyRuleAddress,
  privacyRuleForAddress,
  PRIVACY_RULE_NEW_VALUE,
  PRIVACY_RULE_QUERY_KEY,
  PRIVACY_SCOPE_QUERY_KEY,
} from "./data-privacy.screen";
export { dataPrivacyApi } from "../../behavior/data-privacy-api";
export {
  DataPrivacyHostPort,
  DataPrivacyHostProvider,
  type PrivacyFailureNotice,
  type PrivacyHostScope,
  type PrivacyRouteReading,
  type PrivacySuccessNotice,
} from "../../model/data-privacy-host";
