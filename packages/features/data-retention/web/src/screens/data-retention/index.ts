/**
 * The Data Retention family, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry. What it exposes for the
 * page is a LOADER rather than a component, because the screen drags a drawer,
 * two confirm dialogs and two cards behind it and none of that belongs in the
 * chunk that renders the rest of the application.
 *
 * ONE SCREEN, ONE ADDRESS: `/settings/data-retention`.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC
 * Provider this package's hooks run on, and the host port that answers for the
 * scope, the plan tier, the platform-admin flag, the visible scopes, the
 * address and the two notices.
 */

import type { ComponentType } from "react";

export type DataRetentionScreenLoader = () => Promise<{ default: ComponentType }>;

export const dataRetentionScreens = {
  dataRetention: () => import("./data-retention.screen"),
} as const satisfies Record<string, DataRetentionScreenLoader>;

export type DataRetentionScreenName = keyof typeof dataRetentionScreens;

export { RETENTION_SCOPE_QUERY_KEY } from "./data-retention.screen";
export { dataRetentionApi } from "../../behavior/data-retention-api";
export {
  DataRetentionHostPort,
  DataRetentionHostProvider,
  type RetentionAvailableScopes,
  type RetentionFailureNotice,
  type RetentionHostScope,
  type RetentionRouteReading,
  type RetentionSuccessNotice,
} from "../../model/data-retention-host";
