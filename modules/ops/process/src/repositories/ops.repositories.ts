import type { ProcessStore } from "@langwatch/eventing";
import type { MigrationLeaseRepository } from "@langwatch/system-migrations";

import type { AnomalyStateRepository } from "./anomaly.repository.ts";
import type { BlobStoreRepository } from "./blob-store.repository.ts";
import type { BugReportRepository } from "./bug-report.repository.ts";
import type { CredentialsResealRepository } from "./credentials-reseal.repository.ts";
import type {
  PostgresHealthRepository,
  RedisHealthRepository,
} from "./datastore-health.repository.ts";
import type { EventExplorerRepository } from "./event-explorer.repository.ts";
import type { ImpersonationRepository } from "./impersonation.repository.ts";
import type { AdminBackofficeRepository } from "./instance-admin.repository.ts";
import type { MigrationMembershipRepository } from "./migration-membership.repository.ts";
import type { OpsMetricsRepository } from "./ops-metrics.repository.ts";
import type { OpsSnapshotRepository } from "./ops-snapshot.repository.ts";
import type { OrganizationTenantSourceRepository } from "./organization-tenant-source.repository.ts";
import type { ProcessManagerPurgeRepository } from "./process-manager-purge.repository.ts";
import type { ProcessOpsRepository } from "./process-ops.repository.ts";
import type { ProjectTenantSourceRepository } from "./project-tenant-source.repository.ts";
import type { QueueRepository } from "./queue.repository.ts";
import type { ReplayRepository } from "./replay.repository.ts";
import type { StorageFootprintRepository } from "./storage-footprint.repository.ts";
import type { StorageStatsReadingsRepository } from "./storage-stats-readings.repository.ts";
import type { SystemMigrationEnrollmentRepository } from "./system-migration-enrollment.repository.ts";
import type { SystemMigrationStateRepository } from "./system-migration-state.repository.ts";
import type {
  OrganizationMemberTenantSourceRepository,
  UserTenantSourceRepository,
} from "./user-tenant-source.repository.ts";

/**
 * The rows this module owns in the platform's own database (the support inbox and the system
 * migration ledger and enrollment), the process-manager store the manager explorer reads, the
 * migration pass's tenant walks and its lease, and the operator readings over every store.
 */
export interface OpsRepositories {
  readonly bugReports: BugReportRepository;
  readonly processStore: ProcessStore;
  /** The outbox and inbox retention purge only the process-manager-purge task runs. */
  readonly processManagerPurge: ProcessManagerPurgeRepository;
  /** The walk over every stored sealed value only the credentials-reseal task makes. */
  readonly credentialsReseal: CredentialsResealRepository;
  readonly migrationState: SystemMigrationStateRepository;
  readonly migrationEnrollments: SystemMigrationEnrollmentRepository;
  readonly migrationMemberships: MigrationMembershipRepository;
  readonly migrationLease: MigrationLeaseRepository;
  readonly organizationTenants: OrganizationTenantSourceRepository;
  readonly projectTenants: ProjectTenantSourceRepository;
  readonly userTenants: UserTenantSourceRepository;
  readonly organizationMemberTenants: OrganizationMemberTenantSourceRepository;
  readonly instanceAdmin: AdminBackofficeRepository;
  readonly impersonation: ImpersonationRepository;
  readonly processFleet: ProcessOpsRepository;
  readonly postgresHealth: PostgresHealthRepository;
  /** The dashboard's published snapshots and the queue counters its writer reads. */
  readonly snapshots: OpsSnapshotRepository;
  readonly metrics: OpsMetricsRepository;
  readonly queues: QueueRepository;
  readonly blobStore: BlobStoreRepository;
  readonly replay: ReplayRepository;
  readonly anomalyState: AnomalyStateRepository;
  readonly storageReadings: StorageStatsReadingsRepository;
  readonly redisHealth: RedisHealthRepository;
  readonly events: EventExplorerRepository;
  readonly storageFootprint: StorageFootprintRepository;
}
