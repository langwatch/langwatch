export { dataRetentionServer } from "./data-retention.server.ts";
export { dataRetentionTrpcTransport } from "./transport/data-retention.trpc.ts";
export type {
  DataRetentionAppConfig,
  DataRetentionInfrastructure,
  TenantClickHouseClientResolver,
} from "./app/data-retention.app.ts";
/**
 * The two capabilities a process supplies: the organization lineage a rule is
 * placed and gated against, and the plan behind the gate. Both read stores this
 * feature deliberately does not own.
 */
export {
  DataRetentionDirectoryPort,
  type RetentionOrganizationDirectory,
  type RetentionProjectLineage,
} from "./ports/data-retention-directory.port.ts";
export { DataRetentionPlanPort, type DataRetentionPlan } from "./ports/data-retention-plan.port.ts";
export { PrismaDataRetentionDirectoryRepository } from "./repositories/prisma/prisma.data-retention-directory.repository.ts";
