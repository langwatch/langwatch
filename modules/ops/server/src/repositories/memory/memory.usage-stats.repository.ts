import type {
  UsageStatsCountInput,
  UsageStatsOrganization,
  UsageStatsProjectCounts,
} from "../../app/ops.app.ts";
import {
  UsageStatsClickHouseRepository,
  UsageStatsOrganizationRepository,
  UsageStatsProjectRepository,
} from "../observe/usage-stats.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

const EMPTY_COUNTS: Omit<UsageStatsProjectCounts, "projectIds"> = {
  annotations: 0,
  annotationQueues: 0,
  annotationQueueItems: 0,
  annotationScores: 0,
  batchEvaluations: 0,
  customGraphs: 0,
  datasets: 0,
  datasetRecords: 0,
  experiments: 0,
  triggers: 0,
  workflows: 0,
};

/** The organizations the usage-stats worker reports on, in memory. */
export class MemoryUsageStatsOrganizationRepository extends UsageStatsOrganizationRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryUsageStatsOrganizationRepository {
    return new MemoryUsageStatsOrganizationRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async listForUsageStats(): Promise<UsageStatsOrganization[]> {
    return [...this.store.usageStatsOrganizations];
  }
}

/** The project-scoped relational usage counts, in memory, keyed by organization id. */
export class MemoryUsageStatsProjectRepository extends UsageStatsProjectRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryUsageStatsProjectRepository {
    return new MemoryUsageStatsProjectRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async collectProjectCounts({
    organizationId,
  }: {
    organizationId: string;
    builderChartKind: string;
  }): Promise<UsageStatsProjectCounts> {
    return (
      this.store.usageStatsProjectCounts.get(organizationId) ?? {
        projectIds: [],
        ...EMPTY_COUNTS,
      }
    );
  }
}

/** The organization-wide ClickHouse usage counts, in memory, keyed by organization id. */
export class MemoryUsageStatsClickHouseRepository extends UsageStatsClickHouseRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryUsageStatsClickHouseRepository {
    return new MemoryUsageStatsClickHouseRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async findTraceCount({ organizationId }: UsageStatsCountInput): Promise<number> {
    return this.store.usageStatsClickHouseCounts.get(organizationId)?.traceCount ?? 0;
  }

  async findScenarioRunCount({ organizationId }: UsageStatsCountInput): Promise<number> {
    return this.store.usageStatsClickHouseCounts.get(organizationId)?.scenarioRunCount ?? 0;
  }
}
