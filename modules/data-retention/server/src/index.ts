export { dataRetentionServer } from "./data-retention.server.ts";
export { dataRetentionTrpcTransport } from "./transport/data-retention.trpc.ts";
/**
 * The two capabilities a process supplies: the organization lineage a rule is
 * placed and gated against, and the plan behind the gate. Both read stores this
 * feature deliberately does not own.
 */
export type {
  DataRetentionAppConfig,
  DataRetentionDirectoryReader,
  DataRetentionInfrastructure,
  RetentionOrganizationDirectory,
  RetentionProjectLineage,
  TenantClickHouseClientResolver,
} from "./app/data-retention.app.ts";
export {
  type DataRetentionPlan,
  type DataRetentionPlanResolver,
} from "./app/data-retention.members.ts";
export { PrismaDataRetentionDirectoryRepository } from "./repositories/prisma/prisma.data-retention-directory.repository.ts";
