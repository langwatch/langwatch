/**
 * The Data Retention family, at `/settings/data-retention`. A LOADER rather
 * than a component: the screen drags a drawer, two confirm dialogs and two
 * cards behind it. The owning frontend feature mounts the host port below it.
 */

import type { ComponentType } from "react";

export type DataRetentionScreenLoader = () => Promise<{ default: ComponentType }>;

export const dataRetentionScreens = {
  dataRetention: () => import("./ui/sections/data-retention.screen.tsx"),
} as const satisfies Record<string, DataRetentionScreenLoader>;

export type DataRetentionScreenName = keyof typeof dataRetentionScreens;

export { RETENTION_SCOPE_QUERY_KEY } from "./ui/sections/data-retention.screen.tsx";
export { dataRetentionApi, type DataRetentionApiMap } from "./behavior/data-retention-api.ts";
export {
  DataRetentionHostPort,
  DataRetentionHostProvider,
  type RetentionAvailableScopes,
  type RetentionFailureNotice,
  type RetentionHostScope,
  type RetentionRouteReading,
  type RetentionSuccessNotice,
} from "./model/data-retention-host.ts";
