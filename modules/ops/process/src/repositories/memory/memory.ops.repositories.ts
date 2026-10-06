import { InMemoryProcessStore } from "@langwatch/eventing";

import { NullBlobStoreRepository } from "../blob-store.repository.ts";
import type { OpsRepositories } from "../ops.repositories.ts";
import { NullQueueRepository } from "../queue.repository.ts";
import { MemoryAnomalyStateRepository } from "./memory.anomaly-state.repository.ts";
import { MemoryBugReportRepository } from "./memory.bug-report.repository.ts";
import { MemoryCredentialsResealRepository } from "./memory.credentials-reseal.repository.ts";
import {
  MemoryPostgresHealthRepository,
  MemoryRedisHealthRepository,
} from "./memory.datastore-health.repository.ts";
import { MemoryEventExplorerRepository } from "./memory.event-explorer.repository.ts";
import { MemoryImpersonationRepository } from "./memory.impersonation.repository.ts";
import { MemoryInstanceAdminRepository } from "./memory.instance-admin.repository.ts";
import { MemoryMigrationLeaseRepository } from "./memory.migration-lease.repository.ts";
import { MemoryMigrationMembershipRepository } from "./memory.migration-membership.repository.ts";
import { MemoryOpsMetricsRepository } from "./memory.ops-metrics.repository.ts";
import { MemoryOpsSnapshotRepository } from "./memory.ops-snapshot.repository.ts";
import { MemoryOpsStore } from "./memory.ops.store.ts";
import { MemoryOrganizationTenantSourceRepository } from "./memory.organization-tenant-source.repository.ts";
import { MemoryProcessManagerPurgeRepository } from "./memory.process-manager-purge.repository.ts";
import { MemoryProcessOpsRepository } from "./memory.process-ops.repository.ts";
import { MemoryProjectTenantSourceRepository } from "./memory.project-tenant-source.repository.ts";
import { MemoryReplayRepository } from "./memory.replay.repository.ts";
import { MemoryStorageFootprintRepository } from "./memory.storage-footprint.repository.ts";
import { MemoryStorageStatsReadingsRepository } from "./memory.storage-stats-readings.repository.ts";
import { MemorySystemMigrationEnrollmentRepository } from "./memory.system-migration-enrollment.repository.ts";
import { MemorySystemMigrationStateRepository } from "./memory.system-migration-state.repository.ts";
import {
  MemoryOrganizationMemberTenantSourceRepository,
  MemoryUserTenantSourceRepository,
} from "./memory.user-tenant-source.repository.ts";

/**
 * One store per composed process, shared by every twin, so a row one
 * repository writes is a row the next one reads. A memory process keeps no
 * GroupQueue in Redis, so the queue and blob readings answer empty.
 */
export class MemoryOpsRepositories {
  static readonly requires = [] as const;

  static create(): OpsRepositories {
    const store = MemoryOpsStore.create();

    return {
      bugReports: MemoryBugReportRepository.create({ store }),
      processStore: InMemoryProcessStore.createForLocalDevelopment(),
      processManagerPurge: MemoryProcessManagerPurgeRepository.create(),
      credentialsReseal: MemoryCredentialsResealRepository.create(),
      migrationState: MemorySystemMigrationStateRepository.create(),
      migrationEnrollments: MemorySystemMigrationEnrollmentRepository.create(),
      migrationMemberships: MemoryMigrationMembershipRepository.create(),
      migrationLease: MemoryMigrationLeaseRepository.create(),
      organizationTenants: MemoryOrganizationTenantSourceRepository.create(),
      projectTenants: MemoryProjectTenantSourceRepository.create(),
      userTenants: MemoryUserTenantSourceRepository.create(),
      organizationMemberTenants: MemoryOrganizationMemberTenantSourceRepository.create(),
      instanceAdmin: MemoryInstanceAdminRepository.create({ store }),
      impersonation: MemoryImpersonationRepository.create({ store }),
      processFleet: MemoryProcessOpsRepository.create({ store }),
      postgresHealth: MemoryPostgresHealthRepository.create(),
      snapshots: MemoryOpsSnapshotRepository.create({ store }),
      metrics: MemoryOpsMetricsRepository.create({ store }),
      queues: NullQueueRepository.create(),
      blobStore: NullBlobStoreRepository.create(),
      replay: MemoryReplayRepository.create({ store }),
      anomalyState: MemoryAnomalyStateRepository.create({ store }),
      storageReadings: MemoryStorageStatsReadingsRepository.create({ store }),
      redisHealth: MemoryRedisHealthRepository.create(),
      events: MemoryEventExplorerRepository.create({ store }),
      storageFootprint: MemoryStorageFootprintRepository.create(),
    };
  }
}
