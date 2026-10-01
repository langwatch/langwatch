/**
 * The Data Retention family, at `/settings/data-retention`. A LOADER rather
 * than a component: the screen drags a drawer, two confirm dialogs and two
 * cards behind it. The owning frontend feature mounts the host port below it.
 */

export { dataRetentionApi, type DataRetentionApiMap } from "./behavior/data-retention-api.ts";
export {
  DataRetentionHostApi,
  DataRetentionHostProvider,
  RETENTION_SCOPE_QUERY_KEY,
  type RetentionAvailableScopes,
  type RetentionFailureNotice,
  type RetentionHostScope,
  type RetentionRouteReading,
  type RetentionSuccessNotice,
} from "./model/data-retention-host.ts";
