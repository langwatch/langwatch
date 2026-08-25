export { PostgresOpsAdapter, type PostgresOpsAdapterOptions } from "./adapters/postgres.ops.adapter";
export { AdminAuditSink } from "./services/impersonation.service";

export type { UserWithBackofficeIncludes } from "@langwatch/ops-contract";
import { PostgresOpsAdapter } from "./adapters/postgres.ops.adapter";
export const mapUserToBackofficeRow =
  PostgresOpsAdapter.mapUserToBackofficeRow;
export const ORGANIZATION_SAFE_SELECT =
  PostgresOpsAdapter.organizationSafeSelect;
export const PROJECT_SAFE_SELECT = PostgresOpsAdapter.projectSafeSelect;
export const USER_BACKOFFICE_INCLUDE =
  PostgresOpsAdapter.userBackofficeInclude;
