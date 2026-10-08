import { type EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import type { TenantSource } from "@langwatch/system-migrations";

import type { OpsReplayRuntime } from "../../app/ops.app.ts";
import { NullBlobStoreRepository } from "../blob-store.repository.ts";
import { ClickHouseRoutesRepository } from "../clickhouse.routes.repository.ts";
import { EventingPipelineDefinitionsRepository } from "../eventing/eventing.pipeline-definitions.repository.ts";
import type { MigrationMembershipRepository } from "../migration-membership.repository.ts";
import type { OpsRepositories } from "../ops.repositories.ts";
import type { OrganizationTenantSourceRepository } from "../organization-tenant-source.repository.ts";
import type { ProjectTenantSourceRepository } from "../project-tenant-source.repository.ts";
import { NullQueueRepository } from "../queue.repository.ts";
import { ReplayRuntimeRepository } from "../replay-runtime.repository.ts";
import { MemoryAnomalyRateTrackerRepository } from "./memory.anomaly-rate-tracker.repository.ts";
import { MemoryAnomalyStateRepository } from "./memory.anomaly-state.repository.ts";
import { MemoryBugReportRepository } from "./memory.bug-report.repository.ts";
import { MemoryCredentialsResealRepository } from "./memory.credentials-reseal.repository.ts";
import {
  MemoryClickHouseHealthRepository,
  MemoryPostgresHealthRepository,
  MemoryRedisHealthRepository,
} from "./memory.datastore-health.repository.ts";
import { MemoryEventExplorerRepository } from "./memory.event-explorer.repository.ts";
import { MemoryImpersonationRepository } from "./memory.impersonation.repository.ts";
import { MemoryInstanceAdminRepository } from "./memory.instance-admin.repository.ts";
import { MemoryMigrationLeaseRepository } from "./memory.migration-lease.repository.ts";
import { MemoryOpsMetricsRepository } from "./memory.ops-metrics.repository.ts";
import { MemoryOpsSnapshotRepository } from "./memory.ops-snapshot.repository.ts";
import { MemoryOpsStore } from "./memory.ops.store.ts";
import { MemoryProcessManagerPurgeRepository } from "./memory.process-manager-purge.repository.ts";
import { MemoryProcessOpsRepository } from "./memory.process-ops.repository.ts";
import { MemoryReplayRepository } from "./memory.replay.repository.ts";
import { MemoryStorageFootprintRepository } from "./memory.storage-footprint.repository.ts";
import { MemoryStorageStatsReadingsRepository } from "./memory.storage-stats-readings.repository.ts";
import { MemorySystemMigrationEnrollmentRepository } from "./memory.system-migration-enrollment.repository.ts";
import { MemorySystemMigrationStateRepository } from "./memory.system-migration-state.repository.ts";
import { MemoryUpgradeLedgerRepository } from "./memory.upgrade-ledger.repository.ts";
import {
  MemoryOrganizationMemberTenantSourceRepository,
  MemoryUserTenantSourceRepository,
} from "./memory.user-tenant-source.repository.ts";

/** A memory process holds no event log in ClickHouse and no Redis, so a replay run refuses. */
class MemoryReplayRuntimeRepository extends ReplayRuntimeRepository {
  static create(): MemoryReplayRuntimeRepository {
    return new MemoryReplayRuntimeRepository();
  }

  create(): OpsReplayRuntime {
    throw new Error("Replay requires the live stores: a memory process holds no event log.");
  }
}

/** The project table is not ops' to hold, so this tier walks no project. */
class MemoryProjectTenantSourceRepository implements ProjectTenantSourceRepository {
  static create(): MemoryProjectTenantSourceRepository {
    return new MemoryProjectTenantSourceRepository();
  }

  private constructor() {}

  async findTenantIdsAfter(_input: { cursor: string | null; limit: number }): Promise<string[]> {
    return [];
  }

  async getOrganizationId(projectId: string): Promise<string> {
    throw new Error(`no project ${projectId} in the memory tier`);
  }
}

/** The organization table is not ops' to hold, so this tier walks no organization. */
class MemoryOrganizationTenantSourceRepository implements OrganizationTenantSourceRepository {
  static create(): MemoryOrganizationTenantSourceRepository {
    return new MemoryOrganizationTenantSourceRepository();
  }

  private constructor() {}

  async findTenantIdsAfter(_input: { cursor: string | null; limit: number }): Promise<string[]> {
    return [];
  }

  pendingFor(_input: { migrationNames: readonly string[] }): TenantSource {
    return this;
  }
}

/** Memberships are not ops' to hold, so this tier finds no user in any organization. */
class MemoryMigrationMembershipRepository implements MigrationMembershipRepository {
  static create(): MemoryMigrationMembershipRepository {
    return new MemoryMigrationMembershipRepository();
  }

  private constructor() {}

  async isMemberOfAny(_input: {
    userId: string;
    organizationIds: readonly string[];
  }): Promise<boolean> {
    return false;
  }
}

/** A memory process holds no ClickHouse, so no organization is privately routed. */
class MemoryClickHouseRoutesRepository extends ClickHouseRoutesRepository {
  static create(): MemoryClickHouseRoutesRepository {
    return new MemoryClickHouseRoutesRepository();
  }

  findPrivateRoutes(): ReadonlyMap<string, string> {
    return new Map();
  }
}

/**
 * One store per composed process, shared by every twin, so a row one
 * repository writes is a row the next one reads. A memory process keeps no
 * GroupQueue in Redis, so the queue and blob readings answer empty.
 */
export class MemoryOpsRepositories {
  /** Introspection reads the registered pipelines in memory too (Q212). */
  static readonly requires = ["eventing"] as const;

  static create({
    eventing,
  }: Readonly<{ eventing: Pick<EventSourcing, "definitions"> }>): OpsRepositories {
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
      replayRuntimes: MemoryReplayRuntimeRepository.create(),
      pipelineDefinitions: EventingPipelineDefinitionsRepository.create({ eventing }),
      clickhouseRoutes: MemoryClickHouseRoutesRepository.create(),
      anomalyState: MemoryAnomalyStateRepository.create({ store }),
      rateTracker: MemoryAnomalyRateTrackerRepository.create({ store }),
      storageReadings: MemoryStorageStatsReadingsRepository.create({ store }),
      redisHealth: MemoryRedisHealthRepository.create(),
      clickhouseHealth: MemoryClickHouseHealthRepository.create(),
      events: MemoryEventExplorerRepository.create({ store }),
      storageFootprint: MemoryStorageFootprintRepository.create(),
      upgradeLedger: MemoryUpgradeLedgerRepository.create(),
    };
  }
}
