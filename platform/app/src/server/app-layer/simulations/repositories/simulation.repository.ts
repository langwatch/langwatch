import type {
  BatchHistoryResult,
  BatchRunDataResult,
  ExternalSetSummary,
  ScenarioRunData,
  ScenarioSetData,
} from "~/server/scenarios/scenario-event.types";

/**
 * A run carrying the two columns the shared mapper drops but an export needs.
 *
 * `scenarioSetId` — the UI resolves it per batch instead, but an "All Runs"
 * export spans sets, so each row has to say which one it came from.
 *
 * `traceIds` — the run-level TraceIds column, unioned with the per-message
 * trace ids by the exporter. On a 228-run sample the run-level column was a
 * strict subset and contributed nothing, but the two are written by
 * independent code paths and a run can finish with traces recorded and no
 * message snapshot, so the union is kept as cheap insurance rather than
 * because it currently adds ids.
 *
 * Both values are already on the ClickHouse row.
 */
export type ExportableRun = ScenarioRunData & {
  scenarioSetId: string;
  traceIds: string[];
};

export type AllSuitesRunDataResult =
  | { changed: false; lastUpdatedAt: number }
  | {
      changed: true;
      lastUpdatedAt: number;
      runs: ScenarioRunData[];
      scenarioSetIds: Record<string, string>;
      nextCursor?: string;
      hasMore: boolean;
    };

export interface SimulationRepository {
  getScenarioSetsData(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ScenarioSetData[]>;

  getScenarioRunData(params: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<ScenarioRunData | null>;

  getBatchHistoryForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<BatchHistoryResult>;

  getRunDataForBatchRun(params: {
    projectId: string;
    scenarioSetId?: string;
    batchRunId: string;
    sinceTimestamp?: number;
  }): Promise<BatchRunDataResult>;

  getRunDataForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
    /**
     * Reads whole conversations instead of the trimmed list projection. The
     * page size is capped lower when set, because the heavy message arrays
     * are exactly what the trim protects against.
     */
    shouldIncludeMessages?: boolean;
  }): Promise<{
    runs: ScenarioRunData[];
    nextCursor?: string;
    hasMore: boolean;
  }>;

  getAllRunDataForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<ScenarioRunData[]>;

  getBatchRunCountForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number>;

  getExternalSetSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ExternalSetSummary[]>;

  getInternalSuiteSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ExternalSetSummary[]>;

  getRunDataForAllSuites(params: {
    projectId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
    sinceTimestamp?: number;
    shouldIncludeMessages?: boolean;
  }): Promise<AllSuitesRunDataResult>;

  /**
   * Returns the latest UpdatedAt (Unix ms) across the project's runs in the
   * given window — a cheap freshness signal the UI polls instead of re-reading
   * run payloads. Includes archived rows on purpose: archiving bumps UpdatedAt,
   * and the list must refresh to drop the archived run.
   */
  findLastUpdatedAt(params: {
    projectId: string;
    scenarioSetId?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number>;

  /**
   * Returns the run ids for a SPECIFIC scenario set — never the whole project.
   * `scenarioSetId` is required so callers cannot address every run in a tenant
   * with one unqualified request. Results are capped; `reachedCap` signals that
   * the cap was hit and more matching runs may exist beyond what was returned.
   */
  findAllRunIdsForSet(params: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<{ runIds: string[]; reachedCap: boolean }>;

  /**
   * Returns distinct external (non-internal) scenario set IDs across the given projects.
   * Used for cross-org counting of scenario sets for limit enforcement.
   */
  getDistinctExternalSetIds(params: {
    projectIds: string[];
  }): Promise<Set<string>>;

  /**
   * Total runs an export sweep will visit, for the progress total. Shares its
   * filter construction with findRunsForExport so the two cannot disagree.
   */
  countRunsForExport(params: {
    projectId: string;
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number>;

  /**
   * One forward-only page of runs for a CSV export, oldest first, keyset
   * paginated. Callers drive it to exhaustion via `nextCursor`.
   */
  findRunsForExport(params: {
    projectId: string;
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
    limit: number;
    cursor?: string;
  }): Promise<{
    runs: ExportableRun[];
    nextCursor?: string;
    hasMore: boolean;
  }>;
}

export class NullSimulationRepository implements SimulationRepository {
  async getScenarioSetsData(): Promise<ScenarioSetData[]> {
    return [];
  }

  async getScenarioRunData(): Promise<ScenarioRunData | null> {
    return null;
  }

  async getBatchHistoryForScenarioSet(): Promise<BatchHistoryResult> {
    return { batches: [], hasMore: false, lastUpdatedAt: 0, totalCount: 0 };
  }

  async getRunDataForBatchRun(): Promise<BatchRunDataResult> {
    return { changed: true, lastUpdatedAt: 0, runs: [] };
  }

  async getRunDataForScenarioSet(): Promise<{
    runs: ScenarioRunData[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return { runs: [], hasMore: false };
  }

  async getAllRunDataForScenarioSet(): Promise<ScenarioRunData[]> {
    return [];
  }

  async getBatchRunCountForScenarioSet(): Promise<number> {
    return 0;
  }

  async getExternalSetSummaries(): Promise<ExternalSetSummary[]> {
    return [];
  }

  async getInternalSuiteSummaries(): Promise<ExternalSetSummary[]> {
    return [];
  }

  async getRunDataForAllSuites(): Promise<AllSuitesRunDataResult> {
    return {
      changed: true,
      lastUpdatedAt: 0,
      runs: [],
      scenarioSetIds: {},
      hasMore: false,
    };
  }

  async findLastUpdatedAt(): Promise<number> {
    return 0;
  }

  async findAllRunIdsForSet(): Promise<{
    runIds: string[];
    reachedCap: boolean;
  }> {
    return { runIds: [], reachedCap: false };
  }

  async getDistinctExternalSetIds(): Promise<Set<string>> {
    return new Set();
  }

  async countRunsForExport(): Promise<number> {
    return 0;
  }

  async findRunsForExport(): Promise<{
    runs: ExportableRun[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return { runs: [], hasMore: false };
  }
}
