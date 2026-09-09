export type { MigrationLeaseRepository } from "./lease.repository.ts";
export {
  type MigrationCohort,
  type SystemMigrationRunnerDeps,
  SystemMigrationRunnerService,
} from "./runner.service.ts";
export type { SystemMigrationStateRepository } from "./state.repository.ts";
export type { SystemMigration } from "./system-migration.ts";
export type { TenantSource } from "./tenant-source.ts";
export {
  isTerminalTenantStatus,
  type MigrationPassSummary,
  type TenantMigrationOutcome,
  type TenantMigrationRecord,
  type TenantMigrationStatus,
} from "./types.ts";
export {
  driveSystemMigrationsToConvergence,
  runSystemMigrationsAtStartup,
  startSystemMigrations,
  SystemMigrationStartupIncompleteError,
  type SystemMigrationExecutionMode,
  type SystemMigrationPass,
} from "./convergence.ts";
