export interface UsageStatsOrganization {
  id: string;
  name: string;
}

export interface UsageStatsProjectCounts {
  projectIds: string[];
  annotations: number;
  annotationQueues: number;
  annotationQueueItems: number;
  annotationScores: number;
  batchEvaluations: number;
  customGraphs: number;
  datasets: number;
  datasetRecords: number;
  experiments: number;
  triggers: number;
  workflows: number;
}

export interface UsageStatsCountDelegate {
  count(input: { where: { projectId: { in: string[] } } }): Promise<number>;
}

export interface UsageStatsOrganizationDatabase {
  organization: {
    findMany(input: { select: { id: true; name: true } }): Promise<UsageStatsOrganization[]>;
  };
}

export interface UsageStatsProjectDatabase {
  project: {
    findMany(input: {
      where: { team: { organizationId: string } };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  annotation: UsageStatsCountDelegate;
  annotationQueue: UsageStatsCountDelegate;
  annotationQueueItem: UsageStatsCountDelegate;
  annotationScore: UsageStatsCountDelegate;
  batchEvaluation: UsageStatsCountDelegate;
  customGraph: {
    count(input: { where: { projectId: { in: string[] }; kind: string } }): Promise<number>;
  };
  dataset: UsageStatsCountDelegate;
  datasetRecord: UsageStatsCountDelegate;
  experiment: UsageStatsCountDelegate;
  trigger: UsageStatsCountDelegate;
  workflow: UsageStatsCountDelegate;
}

export interface UsageStatsWorkerDatabase
  extends UsageStatsOrganizationDatabase, UsageStatsProjectDatabase {}

export interface UsageStatsReport extends Omit<UsageStatsProjectCounts, "projectIds"> {
  totalTraces: number;
  totalScenarioEvents: number;
  timestamp: string;
}

export interface UsageStatsCountInput {
  organizationId: string;
  projectIds: string[];
}

export interface UsageStatsClickHouseQuery {
  query: string;
  query_params: { projectIds: string[] };
  format: "JSONEachRow";
}

export interface UsageStatsClickHouseQueryResult {
  json(): Promise<unknown>;
}

export abstract class UsageStatsClickHouseClient {
  abstract query(input: UsageStatsClickHouseQuery): Promise<UsageStatsClickHouseQueryResult>;
}

/** Resolves the ClickHouse client for the organization owning a report. */
export abstract class UsageStatsClickHouseClientResolver {
  abstract tryResolve(organizationId: string): Promise<UsageStatsClickHouseClient | null>;
}

/** Private Ops repository boundary for project-scoped relational usage. */
export abstract class UsageStatsProjectRepository {
  abstract collectProjectCounts(input: {
    organizationId: string;
    builderChartKind: string;
  }): Promise<UsageStatsProjectCounts>;
}

/** Private Ops repository boundary for organization-wide ClickHouse usage. */
export abstract class UsageStatsClickHouseRepository {
  abstract findTraceCount(input: UsageStatsCountInput): Promise<number>;
  abstract findScenarioRunCount(input: UsageStatsCountInput): Promise<number>;
}

export interface UsageStatsCollector {
  collect(input: { organizationId: string }): Promise<UsageStatsReport>;
}

/** Private Ops repository boundary for organizations that need reporting. */
export abstract class UsageStatsOrganizationRepository {
  abstract listForUsageStats(): Promise<UsageStatsOrganization[]>;
}

/** Infrastructure boundary for the self-hosted telemetry receiver. */
export abstract class UsageStatsTelemetryClient {
  abstract send(report: Record<string, unknown>): Promise<void>;
}

/** Infrastructure boundary for reporting a per-organization delivery failure. */
export abstract class UsageStatsErrorReporter {
  abstract capture(input: { instanceId: string; error: unknown }): Promise<void>;
}
