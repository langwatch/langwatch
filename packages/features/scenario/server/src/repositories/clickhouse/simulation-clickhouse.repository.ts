import {
  AGENT_TEST_SET_SUFFIX,
  RUN_ACTOR_LABELS,
  type RunActor,
} from "@langwatch/scenario-contract";
import type {
  SimulationBatchHistory,
  SimulationBatchSummary,
  SimulationExternalSetSummary,
  SimulationLastResultSummary,
  SimulationRunData,
  SimulationSetData,
} from "@langwatch/scenario-contract";
import { SimulationRunStatus } from "@langwatch/scenario-contract";
import { Buffer } from "node:buffer";
import {
  type ClickHouseSimulationRunRow,
  mapClickHouseRowToScenarioRunData,
  mapStatus,
} from "./simulation-run.mapper";
import {
  type SimulationWindowFragment,
  SimulationWindowedReadPort,
} from "../../ports/simulation-windowed-read.port";
import type { SimulationExportRun } from "@langwatch/scenario-contract";
import { SimulationRepository } from "../simulation.repository";

const DEFAULT_SET_ID = "default";
const INTERNAL_SET_PREFIX = "__internal__";

export const TABLE_NAME = "simulation_runs" as const;

export const RUN_ID_CAP = 10000;

/**
 * Sort key for the export sweep as one SQL expression: ORDER BY, the cursor
 * predicate and the returned cursor must all be it, or the next page filters
 * on a column it didn't sort by and silently drops/repeats boundary runs — also coalesces NULL StartedAt so those rows don't strand on page one.
 */
const EXPORT_SORT_KEY = "toUnixTimestamp64Milli(ifNull(t.StartedAt, t.CreatedAt))";

/**
 * Every status a run carries while the batch still owes work: QUEUED and
 * RUNNING belong beside PENDING/IN_PROGRESS since the queue writes them and
 * a batch holding any of the four is not finished.
 */
const RUNNING_STATUSES = "'IN_PROGRESS','PENDING','QUEUED','RUNNING'";

/**
 * Leaves the "Test agent" runs out of a list. They are one-off checks of an
 * agent, not results of a scenario, so no set list, batch list or last-result
 * summary shows them. A run is still read by its own id.
 */
const AGENT_TEST_SET_EXCLUSION = `AND NOT endsWith(ScenarioSetId, '${AGENT_TEST_SET_SUFFIX}')`;

/**
 * Batch-level aggregate SELECT list shared by the batch history page and
 * the single-batch summary, so the two cannot drift. SettledCount is the
 * complement of RUNNING_STATUSES (never a terminal-name list) since a raw FAILURE status the terminal enum doesn't carry would else report forever-unfinished.
 */
const BATCH_AGGREGATE_COLUMNS = `BatchRunId,
        toString(count())                                               AS TotalCount,
        toString(countIf(Status = 'SUCCESS'))                          AS PassCount,
        toString(countIf(Status IN ('FAILED','FAILURE','ERROR','CANCELLED'))) AS FailCount,
        toString(countIf(Status IN (${RUNNING_STATUSES})))             AS RunningCount,
        toString(countIf(Status NOT IN (${RUNNING_STATUSES})))         AS SettledCount,
        toString(countIf(Status = 'STALLED'))                          AS StalledCount,
        toString(toUnixTimestamp64Milli(max(UpdatedAt)))               AS LastUpdatedAt,
        toString(toUnixTimestamp64Milli(max(CreatedAt)))               AS LastRunAt,
        toString(toUnixTimestamp64Milli(
          minIf(UpdatedAt, Status IN ('SUCCESS','FAILED','FAILURE','ERROR','CANCELLED'))
        )) AS FirstCompletedAt,
        toString(if(
          countIf(Status IN (${RUNNING_STATUSES})) = 0,
          toUnixTimestamp64Milli(max(UpdatedAt)),
          0
        )) AS AllCompletedAt,
        toString(toUnixTimestamp64Milli(min(StartedAt)))                AS MinStartedAt,
        toString(toUnixTimestamp64Milli(max(StartedAt)))                AS MaxStartedAt`;

/** One row of BATCH_AGGREGATE_COLUMNS. Every value arrives as a string. */
type BatchAggregateRow = {
  BatchRunId: string;
  TotalCount: string;
  PassCount: string;
  FailCount: string;
  RunningCount: string;
  SettledCount: string;
  StalledCount: string;
  LastUpdatedAt: string;
  LastRunAt: string;
  FirstCompletedAt: string;
  AllCompletedAt: string;
  MinStartedAt: string;
  MaxStartedAt: string;
};

const RUN_COLUMNS = `
  ScenarioRunId, ScenarioId, BatchRunId, ScenarioSetId,
  Status, Name, Description, Metadata,
  \`Messages.Id\`, \`Messages.Role\`, \`Messages.Content\`,
  \`Messages.TraceId\`, \`Messages.Rest\`,
  TraceIds,
  Verdict, Reasoning, MetCriteria, UnmetCriteria, Error,
  toString(DurationMs) AS DurationMs,
  TotalCost, RoleCosts, RoleLatencies,
  toString(toUnixTimestamp64Milli(StartedAt)) AS StartedAt,
  toString(toUnixTimestamp64Milli(CreatedAt)) AS CreatedAt,
  toString(toUnixTimestamp64Milli(UpdatedAt)) AS UpdatedAt,
  toString(toUnixTimestamp64Milli(FinishedAt)) AS FinishedAt,
  toString(toUnixTimestamp64Milli(ArchivedAt)) AS ArchivedAt` as const;

/**
 * Columns for list/grid views — truncated messages (first 6), no heavy JSON
 * (Messages.Rest/TraceId, TraceIds, Reasoning, Error — detail-drawer only).
 * `TotalMessageCount` must stay table-qualified (`t.`) or it measures the sliced array and always reports 6.
 */
const LIST_COLUMNS = `
  ScenarioRunId, ScenarioId, BatchRunId, ScenarioSetId,
  Status, Name, Description, Metadata,
  toString(length(t.\`Messages.Role\`)) AS TotalMessageCount,
  arraySlice(\`Messages.Id\`, 1, 6) AS \`Messages.Id\`,
  arraySlice(\`Messages.Role\`, 1, 6) AS \`Messages.Role\`,
  arraySlice(\`Messages.Content\`, 1, 6) AS \`Messages.Content\`,
  CAST([] AS Array(String)) AS \`Messages.TraceId\`,
  CAST([] AS Array(String)) AS \`Messages.Rest\`,
  CAST([] AS Array(String)) AS TraceIds,
  Verdict,
  CAST(NULL AS Nullable(String)) AS Reasoning,
  MetCriteria, UnmetCriteria,
  CAST(NULL AS Nullable(String)) AS Error,
  toString(DurationMs) AS DurationMs,
  TotalCost, RoleCosts, RoleLatencies,
  toString(toUnixTimestamp64Milli(StartedAt)) AS StartedAt,
  toString(toUnixTimestamp64Milli(CreatedAt)) AS CreatedAt,
  toString(toUnixTimestamp64Milli(UpdatedAt)) AS UpdatedAt,
  toString(toUnixTimestamp64Milli(FinishedAt)) AS FinishedAt,
  toString(toUnixTimestamp64Milli(ArchivedAt)) AS ArchivedAt` as const;

/**
 * The run note, read server-side from run metadata so only the short
 * string crosses the wire — a top-level key an SDK/CI caller also writes;
 * @see specs/suites/run-note-metadata-convention.feature
 */
export const RUN_NOTE_EXPR = "JSONExtractString(ifNull(Metadata, '{}'), 'note')";

/**
 * Who started the run, read server-side from the reserved metadata
 * namespace; the id/label pair is written together — empty id means no
 * person (a project key, or a pre-stamp run). @see specs/scenarios/run-actor-on-runs.feature
 */
export const RUN_ACTOR_ID_EXPR =
  "JSONExtractString(ifNull(Metadata, '{}'), 'langwatch', 'actorId')";
export const RUN_ACTOR_LABEL_EXPR =
  "JSONExtractString(ifNull(Metadata, '{}'), 'langwatch', 'actorLabel')";

/**
 * Page size ceilings for set-level list reads: the trimmed projection caps
 * at 100, a whole-conversation read caps far lower since it reads the full
 * message arrays the trim exists to avoid.
 */
export const LIST_PAGE_LIMIT = 100;
export const FULL_MESSAGES_PAGE_LIMIT = 20;

function groupRunsByBatch(runs: SimulationRunData[]): Map<string, SimulationRunData[]> {
  const byBatch = new Map<string, SimulationRunData[]>();
  for (const run of runs) {
    const existing = byBatch.get(run.batchRunId);
    if (existing) existing.push(run);
    else byBatch.set(run.batchRunId, [run]);
  }
  return byBatch;
}

/** The actor a stored id and label name, or null when they name no person. */
function readActor(params: {
  id: string | null | undefined;
  label: string | null | undefined;
}): RunActor | null {
  if (!params.id) return null;
  const label = RUN_ACTOR_LABELS.find((known) => known === params.label);
  return label ? { id: params.id, label } : null;
}

/** Columns for a slim batch-history preview — no full message arrays. */
const PREVIEW_COLUMNS = `
  ScenarioRunId, BatchRunId, Name, Description, Status,
  toString(DurationMs) AS DurationMs,
  toString(toUnixTimestamp64Milli(UpdatedAt)) AS UpdatedAt,
  toString(toUnixTimestamp64Milli(FinishedAt)) AS FinishedAt,
  ${RUN_NOTE_EXPR} AS Note,
  ${RUN_ACTOR_ID_EXPR} AS ActorId,
  ${RUN_ACTOR_LABEL_EXPR} AS ActorLabel,
  arraySlice(\`Messages.Role\`, 1, 4) AS MessagePreviewRoles,
  arraySlice(\`Messages.Content\`, 1, 4) AS MessagePreviewContents` as const;

interface CursorPayload {
  ts: string;
  batchRunId: string;
}

/** Slim per-run row shape for the batch-history preview (step-2 heavy read). */
interface PreviewItemRow {
  ScenarioRunId: string;
  BatchRunId: string;
  Name: string | null;
  Description: string | null;
  Status: string;
  DurationMs: string | null;
  UpdatedAt: string;
  FinishedAt: string | null;
  Note: string;
  ActorId: string;
  ActorLabel: string;
  MessagePreviewRoles: string[];
  MessagePreviewContents: string[];
}

type SimulationClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, string | string[]>;
    format: "JSONEachRow";
  }): Promise<{ json<Result>(): Promise<Result[]> }>;
};

type SimulationClickHouseClientResolver = (tenantId: string) => Promise<SimulationClickHouseClient>;

export class SimulationClickHouseRepository extends SimulationRepository {
  static create(
    resolveClient: SimulationClickHouseClientResolver,
    windowedRead: SimulationWindowedReadPort,
  ): SimulationClickHouseRepository {
    return new SimulationClickHouseRepository(resolveClient, windowedRead);
  }

  /**
   * Cuts a full-message page at a batch boundary: the page limit selects
   * batches (one batch holds every run of a suite) so the cursor always
   * advances by batch; the first batch is kept whole even if oversized.
   */
  static capRunsAtBatchBoundary({
    runs,
    batchRunIds,
    ceiling,
  }: {
    runs: SimulationRunData[];
    batchRunIds: string[];
    ceiling: number;
  }): { runs: SimulationRunData[]; batchesKept: number } {
    const byBatch = groupRunsByBatch(runs);

    const kept: SimulationRunData[] = [];
    let batchesKept = 0;
    for (const batchRunId of batchRunIds) {
      const batch = byBatch.get(batchRunId) ?? [];
      if (kept.length > 0 && kept.length + batch.length > ceiling) break;
      kept.push(...batch);
      batchesKept++;
      if (kept.length >= ceiling) break;
    }

    return { runs: kept, batchesKept };
  }

  static clampPageLimit({
    limit,
    shouldIncludeMessages,
  }: {
    limit: number;
    shouldIncludeMessages: boolean;
  }): number {
    const ceiling = shouldIncludeMessages ? FULL_MESSAGES_PAGE_LIMIT : LIST_PAGE_LIMIT;
    return Math.min(Math.max(1, limit), ceiling);
  }

  static tryStartedAtBoundsForPage(
    rows: { MinStartedAt: string; MaxStartedAt: string }[],
  ): { minMs: number; maxMs: number } | null {
    let minMs = Number.POSITIVE_INFINITY;
    let maxMs = 0;
    for (const row of rows) {
      const lo = Number(row.MinStartedAt);
      const hi = Number(row.MaxStartedAt);
      if (Number.isFinite(lo) && lo > 0) minMs = Math.min(minMs, lo);
      if (Number.isFinite(hi) && hi > 0) maxMs = Math.max(maxMs, hi);
    }
    if (!Number.isFinite(minMs) || maxMs <= 0 || minMs > maxMs) {
      return null;
    }
    return { minMs, maxMs };
  }

  static buildStartedAtWindowClause(window: SimulationWindowFragment | null): {
    whereClause: string;
    params: Record<string, string>;
  } {
    if (!window) return { whereClause: "", params: {} };
    return {
      whereClause:
        "AND StartedAt >= fromUnixTimestamp64Milli(toUInt64({minStartedAtMs:String})) " +
        "AND StartedAt <= fromUnixTimestamp64Milli(toUInt64({maxStartedAtMs:String}))",
      params: {
        minStartedAtMs: String(window.fromMs),
        maxStartedAtMs: String(window.toMs),
      },
    };
  }

  private constructor(
    private readonly resolveClient: SimulationClickHouseClientResolver,
    private readonly windowedRead: SimulationWindowedReadPort,
  ) {
    super();
  }

  /** Guards against empty/missing tenantId before delegating to the injected resolver. */
  private async getClient(tenantId: string): Promise<SimulationClickHouseClient> {
    if (!tenantId) {
      throw new Error("tenantId is required for ClickHouse client resolution");
    }
    return this.resolveClient(tenantId);
  }

  private async queryRows<T>(
    query: string,
    params: { tenantId: string } & Record<string, string | string[]>,
  ): Promise<T[]> {
    const client = await this.getClient(params.tenantId);
    const result = await client.query({
      query,
      query_params: params,
      format: "JSONEachRow",
    });
    return result.json<T>();
  }

  async getScenarioSetsData({
    projectId,
    startDate,
    endDate,
  }: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationSetData[]> {
    const dateFilter = SimulationClickHouseRepository.buildDateFilter({ startDate, endDate });

    const rows = await this.queryRows<{
      ScenarioSetId: string;
      ScenarioCount: string;
      LastRunAt: string;
    }>(
      `SELECT
        NormalizedSetId AS ScenarioSetId,
        toString(count(*)) AS ScenarioCount,
        toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastRunAt
       FROM (
         SELECT
           -- 'default' must match DEFAULT_SET_ID from internal-set-id.ts
           IF(ScenarioSetId = '', 'default', ScenarioSetId) AS NormalizedSetId,
           UpdatedAt,
           ArchivedAt
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           ${dateFilter.whereClause}
           ${AGENT_TEST_SET_EXCLUSION}
           ${SimulationClickHouseRepository.simulationRunDedupPredicate(`TenantId = {tenantId:String} ${dateFilter.whereClause}`)}
       )
       WHERE ArchivedAt IS NULL
       GROUP BY NormalizedSetId
       ORDER BY LastRunAt DESC`,
      { tenantId: projectId, ...dateFilter.params },
    );

    return rows.map((row) => ({
      scenarioSetId: row.ScenarioSetId,
      scenarioCount: parseInt(row.ScenarioCount, 10),
      lastRunAt: Number(row.LastRunAt),
    }));
  }

  async tryGetScenarioRunData({
    projectId,
    scenarioRunId,
  }: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<SimulationRunData | null> {
    // Uses a scalar subquery to find the latest UpdatedAt, avoiding the old
    // pattern that read all heavy columns (Messages, RoleCosts, etc.) across
    // entire granules (~8K rows) for dedup, causing OOM on parts with large
    // payloads.
    const rows = await this.queryRows<ClickHouseSimulationRunRow & { ExportSortKey: string }>(
      `SELECT ${RUN_COLUMNS},
        toString(${EXPORT_SORT_KEY}) AS ExportSortKey
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         AND t.ScenarioRunId = {scenarioRunId:String}
         AND t.ArchivedAt IS NULL
         AND t.UpdatedAt = (
           SELECT max(s.UpdatedAt)
           FROM ${TABLE_NAME} AS s
           WHERE s.TenantId = {tenantId:String}
             AND s.ScenarioRunId = {scenarioRunId:String}
         )
       LIMIT 1`,
      { tenantId: projectId, scenarioRunId },
    );

    const row = rows[0];
    if (!row) return null;
    return mapClickHouseRowToScenarioRunData(row);
  }

  async getBatchHistoryForScenarioSet({
    projectId,
    scenarioSetId,
    limit = 8,
    cursor,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationBatchHistory> {
    const validatedLimit = Math.min(Math.max(1, limit), 100);
    const decoded = cursor ? this.decodeCursor(cursor) : null;

    const cursorPredicate = decoded
      ? `((toString(toUnixTimestamp64Milli(max(CreatedAt))) < {cursorTs:String})
         OR (toString(toUnixTimestamp64Milli(max(CreatedAt))) = {cursorTs:String} AND BatchRunId > {cursorBatchRunId:String}))`
      : "1 = 1";

    const dateFilter = SimulationClickHouseRepository.buildDateFilter({ startDate, endDate });

    const combinedHaving = `HAVING ${[cursorPredicate, dateFilter.havingClause].filter(Boolean).join(" AND ")}`;

    // Step 0: fetch total distinct batch count (runs in parallel with step 1)
    const totalCountPromise = this.queryRows<{ TotalBatchCount: string }>(
      `SELECT toString(count(DISTINCT BatchRunId)) AS TotalBatchCount
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${SimulationClickHouseRepository.simulationRunDedupPredicate(`TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)}) ${dateFilter.whereClause}`)}`,
      {
        tenantId: projectId,
        scenarioSetIds: SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId),
        ...dateFilter.params,
      },
    );

    // Step 1: fetch batch-level aggregates
    const batchRowsPromise = this.queryRows<BatchAggregateRow>(
      `SELECT ${BATCH_AGGREGATE_COLUMNS}
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${SimulationClickHouseRepository.simulationRunDedupPredicate(`TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)}) ${dateFilter.whereClause}`)}
       GROUP BY BatchRunId
       ${combinedHaving}
       ORDER BY LastRunAt DESC, BatchRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        scenarioSetIds: SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId),
        ...(decoded ? { cursorTs: decoded.ts, cursorBatchRunId: decoded.batchRunId } : {}),
        ...dateFilter.params,
        fetchLimit: String(validatedLimit + 1),
      },
    );

    const [totalCountRows, batchRows] = await Promise.all([totalCountPromise, batchRowsPromise]);
    const totalCount = parseInt(totalCountRows[0]?.TotalBatchCount ?? "0", 10);

    const hasMore = batchRows.length > validatedLimit;
    const pageRows = hasMore ? batchRows.slice(0, validatedLimit) : batchRows;

    if (pageRows.length === 0) {
      return {
        batches: [],
        nextCursor: undefined,
        hasMore: false,
        lastUpdatedAt: 0,
        totalCount,
      };
    }

    const lastRow = pageRows[pageRows.length - 1]!;
    const nextCursor = hasMore
      ? this.encodeCursor(lastRow.LastRunAt, lastRow.BatchRunId)
      : undefined;

    const batchRunIds = pageRows.map((r) => r.BatchRunId);

    // Bounds the heavy step-2 read to the page's StartedAt window (from step
    // 1) via queryWindowed so it's metered exactly once (ADR-067): a range
    // runs windowed/hit; no usable range runs unbounded/unwindowed (the old
    // silent widening, now counted). fallback "none": step 1 already bounded
    // these batches, so an empty windowed read is a genuine empty page.
    const startedAtBounds = SimulationClickHouseRepository.tryStartedAtBoundsForPage(pageRows);

    // Step 2: fetch slim item rows (preview columns only)
    const itemRows = await this.windowedRead.query<PreviewItemRow[]>({
      table: TABLE_NAME,
      hintMs: startedAtBounds ? (startedAtBounds.minMs + startedAtBounds.maxMs) / 2 : null,
      windowMs: startedAtBounds ? (startedAtBounds.maxMs - startedAtBounds.minMs) / 2 : undefined,
      fallback: "none",
      isEmpty: (rows) => rows.length === 0,
      run: (window) => {
        const startedAtWindow = SimulationClickHouseRepository.buildStartedAtWindowClause(window);
        return this.queryRows<PreviewItemRow>(
          `SELECT ${PREVIEW_COLUMNS}
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         AND BatchRunId IN ({batchRunIds:Array(String)})
         AND ArchivedAt IS NULL
         ${startedAtWindow.whereClause}
         ${SimulationClickHouseRepository.simulationRunDedupPredicate("TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)}) AND BatchRunId IN ({batchRunIds:Array(String)})")}
       ORDER BY CreatedAt ASC`,
          {
            tenantId: projectId,
            scenarioSetIds: SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId),
            batchRunIds,
            ...startedAtWindow.params,
          },
        );
      },
    });

    // Group items by batchRunId
    const itemsByBatch = new Map<string, typeof itemRows>();
    for (const row of itemRows) {
      const list = itemsByBatch.get(row.BatchRunId) ?? [];
      list.push(row);
      itemsByBatch.set(row.BatchRunId, list);
    }

    let globalLastUpdatedAt = 0;

    const batches: SimulationBatchHistory["batches"] = pageRows.map((b) => {
      const lastUpdatedAt = Number(b.LastUpdatedAt);
      if (lastUpdatedAt > globalLastUpdatedAt) globalLastUpdatedAt = lastUpdatedAt;

      const items = (itemsByBatch.get(b.BatchRunId) ?? []).map((r) => {
        const baseStatus = mapStatus(r.Status);
        const durationMs = r.DurationMs != null ? parseInt(r.DurationMs, 10) : 0;
        const hasFinished = r.FinishedAt != null && Number(r.FinishedAt) > 0;
        // Stored status is the only truth: unfinished runs collapse to
        // IN_PROGRESS; stalled runs arrive as stored ERROR via the
        // process-manager stall watchdog.
        const resolvedStatus = hasFinished ? baseStatus : SimulationRunStatus.IN_PROGRESS;
        return {
          scenarioRunId: r.ScenarioRunId,
          name: r.Name,
          description: r.Description,
          status: resolvedStatus,
          durationInMs: durationMs,
          messagePreview: (r.MessagePreviewRoles ?? []).map((role, i) => ({
            role,
            content: r.MessagePreviewContents?.[i] ?? "",
          })),
        };
      });

      const stalledCount = items.filter((i) => i.status === "STALLED").length;

      // Every run of a batch is stamped with the same note at queue time, so
      // the first non-empty one is the batch's note. Reading it here costs no
      // extra query: the preview rows are already loaded.
      const note = (itemsByBatch.get(b.BatchRunId) ?? []).find((r) => r.Note !== "")?.Note ?? null;

      // The actor is stamped on every run of a batch at queue time, the same
      // way the note is, so the first run that names one answers for the
      // batch. It rides the preview rows already loaded, so it costs no query.
      const actorRow = (itemsByBatch.get(b.BatchRunId) ?? []).find((r) => r.ActorId !== "");
      const startedBy = readActor({
        id: actorRow?.ActorId,
        label: actorRow?.ActorLabel,
      });

      return {
        ...SimulationClickHouseRepository.mapBatchAggregateRow(b),
        stalledCount,
        note,
        startedBy,
        items,
      };
    });

    return {
      batches,
      nextCursor,
      hasMore,
      lastUpdatedAt: globalLastUpdatedAt,
      totalCount,
    };
  }

  /**
   * One batch's counts, addressed by batch run id alone — unique inside the
   * tenant, so this skips the scenario set and preview items the history page
   * fetches. Returns null when the tenant holds no run for that batch.
   */
  async tryGetBatchSummary({
    projectId,
    batchRunId,
  }: {
    projectId: string;
    batchRunId: string;
  }): Promise<SimulationBatchSummary | null> {
    const whereFilters = "TenantId = {tenantId:String} AND BatchRunId = {batchRunId:String}";

    // The note and the actor are read here and not in BATCH_AGGREGATE_COLUMNS:
    // this query is bounded to one batch, while the history page shares those
    // columns with a step that aggregates over the whole run set.
    const rows = await this.queryRows<
      BatchAggregateRow & { Note: string; ActorId: string; ActorLabel: string }
    >(
      `SELECT ${BATCH_AGGREGATE_COLUMNS},
        anyIf(${RUN_NOTE_EXPR}, ${RUN_NOTE_EXPR} != '')                AS Note,
        anyIf(${RUN_ACTOR_ID_EXPR}, ${RUN_ACTOR_ID_EXPR} != '')        AS ActorId,
        anyIf(${RUN_ACTOR_LABEL_EXPR}, ${RUN_ACTOR_ID_EXPR} != '')     AS ActorLabel
       FROM ${TABLE_NAME}
       WHERE ${whereFilters}
         AND ArchivedAt IS NULL
         ${SimulationClickHouseRepository.simulationRunDedupPredicate(whereFilters)}
       GROUP BY BatchRunId`,
      { tenantId: projectId, batchRunId },
    );

    const row = rows[0];
    if (!row) return null;

    return {
      ...SimulationClickHouseRepository.mapBatchAggregateRow(row),
      stalledCount: Number(row.StalledCount),
      note: row.Note === "" ? null : row.Note,
      startedBy: readActor({ id: row.ActorId, label: row.ActorLabel }),
    };
  }

  async getRunDataForBatchRun({
    projectId,
    scenarioSetId,
    batchRunId,
    sinceTimestamp,
  }: {
    projectId: string;
    scenarioSetId?: string;
    batchRunId: string;
    sinceTimestamp?: number;
  }): Promise<
    | { changed: false; lastUpdatedAt: number }
    | { changed: true; lastUpdatedAt: number; runs: SimulationRunData[] }
  > {
    if (sinceTimestamp !== undefined) {
      const tsRows = await this.queryRows<{ LastUpdatedAt: string }>(
        `SELECT toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastUpdatedAt
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND BatchRunId = {batchRunId:String}
           AND ArchivedAt IS NULL`,
        { tenantId: projectId, batchRunId },
      );
      const lastUpdatedAt = Number(tsRows[0]?.LastUpdatedAt ?? "0");
      if (lastUpdatedAt <= sinceTimestamp) {
        return { changed: false, lastUpdatedAt };
      }
    }

    // The batch id identifies the batch within the tenant on its own; the
    // scenario set id narrows the scan when the caller sends one. The CLI's
    // --wait polls with just the batch id. An empty string is a real value
    // that selects the default set, so only an absent id drops the predicate.
    const scenarioSetIds =
      scenarioSetId === undefined
        ? undefined
        : SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId);
    const setFilter = (alias: string) =>
      scenarioSetIds ? `AND ${alias}ScenarioSetId IN ({scenarioSetIds:Array(String)})` : "";
    const rows = await this.queryRows<ClickHouseSimulationRunRow & { ExportSortKey: string }>(
      `SELECT ${RUN_COLUMNS},
        toString(${EXPORT_SORT_KEY}) AS ExportSortKey
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         ${setFilter("t.")}
         AND t.BatchRunId = {batchRunId:String}
         AND t.ArchivedAt IS NULL
         AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
           SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
           FROM ${TABLE_NAME}
           WHERE TenantId = {tenantId:String}
             ${setFilter("")}
             AND BatchRunId = {batchRunId:String}
           GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
         )
       ORDER BY CreatedAt ASC`,
      {
        tenantId: projectId,
        ...(scenarioSetIds ? { scenarioSetIds } : {}),
        batchRunId,
      },
    );

    const runs = rows.map((row) => mapClickHouseRowToScenarioRunData(row));
    const lastUpdatedAt = runs.reduce((max, r) => Math.max(max, r.timestamp), 0);
    return { changed: true, lastUpdatedAt, runs };
  }

  async getBatchRunCountForScenarioSet({
    projectId,
    scenarioSetId,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number> {
    const dateFilter = SimulationClickHouseRepository.buildDateFilter({ startDate, endDate });

    const rows = await this.queryRows<{ BatchRunCount: string }>(
      `SELECT toString(count(DISTINCT BatchRunId)) AS BatchRunCount
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${SimulationClickHouseRepository.simulationRunDedupPredicate(`TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)}) ${dateFilter.whereClause}`)}`,
      {
        tenantId: projectId,
        scenarioSetIds: SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId),
        ...dateFilter.params,
      },
    );
    return parseInt(rows[0]?.BatchRunCount ?? "0", 10);
  }

  async getAllRunDataForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<SimulationRunData[]> {
    const rows = await this.queryRows<ClickHouseSimulationRunRow & { ExportSortKey: string }>(
      `SELECT ${RUN_COLUMNS},
        toString(${EXPORT_SORT_KEY}) AS ExportSortKey
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         AND t.ScenarioSetId IN ({scenarioSetIds:Array(String)})
         AND t.ArchivedAt IS NULL
         AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
           SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
           FROM ${TABLE_NAME}
           WHERE TenantId = {tenantId:String}
             AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
           GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
         )
       ORDER BY BatchRunId ASC, CreatedAt ASC
       LIMIT 10000`,
      {
        tenantId: projectId,
        scenarioSetIds: SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId),
      },
    );

    return rows.map((row) => mapClickHouseRowToScenarioRunData(row));
  }

  async getRunDataForScenarioSet({
    projectId,
    scenarioSetId,
    limit = 20,
    cursor,
    startDate,
    endDate,
    shouldIncludeMessages = false,
  }: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
    shouldIncludeMessages?: boolean;
  }): Promise<{
    runs: SimulationRunData[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const validatedLimit = SimulationClickHouseRepository.clampPageLimit({
      limit,
      shouldIncludeMessages,
    });
    const decoded = cursor ? this.decodeCursor(cursor) : null;

    const cursorPredicate = decoded
      ? `(
          (toString(toUnixTimestamp64Milli(max(CreatedAt))) < {cursorTs:String})
          OR (toString(toUnixTimestamp64Milli(max(CreatedAt))) = {cursorTs:String} AND BatchRunId > {cursorBatchRunId:String})
        )`
      : "1 = 1";

    const dateFilter = SimulationClickHouseRepository.buildDateFilter({ startDate, endDate });

    const combinedHaving = `HAVING ${[cursorPredicate, dateFilter.havingClause].filter(Boolean).join(" AND ")}`;

    const batchRows = await this.queryRows<{
      BatchRunId: string;
      MaxCreatedAt: string;
    }>(
      `SELECT
        BatchRunId,
        toString(toUnixTimestamp64Milli(max(CreatedAt))) AS MaxCreatedAt
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${SimulationClickHouseRepository.simulationRunDedupPredicate(`TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)}) ${dateFilter.whereClause}`)}
       GROUP BY BatchRunId
       ${combinedHaving}
       ORDER BY MaxCreatedAt DESC, BatchRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        scenarioSetIds: SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId),
        ...(decoded ? { cursorTs: decoded.ts, cursorBatchRunId: decoded.batchRunId } : {}),
        ...dateFilter.params,
        fetchLimit: String(validatedLimit + 1),
      },
    );

    const hasMore = batchRows.length > validatedLimit;
    const pageRows = hasMore ? batchRows.slice(0, validatedLimit) : batchRows;

    if (pageRows.length === 0) {
      return { runs: [], nextCursor: undefined, hasMore: false };
    }

    const lastRow = pageRows[pageRows.length - 1];

    const nextCursor =
      lastRow && hasMore ? this.encodeCursor(lastRow.MaxCreatedAt, lastRow.BatchRunId) : undefined;

    const batchRunIds = pageRows.map((r) => r.BatchRunId);
    const runs = await this.getRunsForBatchIds({
      projectId,
      batchRunIds,
      scenarioSetId,
      shouldIncludeMessages,
    });

    if (!shouldIncludeMessages) return { runs, nextCursor, hasMore };

    const capped = SimulationClickHouseRepository.capRunsAtBatchBoundary({
      runs,
      batchRunIds,
      ceiling: FULL_MESSAGES_PAGE_LIMIT,
    });
    if (capped.batchesKept === pageRows.length) {
      return { runs: capped.runs, nextCursor, hasMore };
    }
    const lastKept = pageRows[capped.batchesKept - 1]!;
    return {
      runs: capped.runs,
      nextCursor: this.encodeCursor(lastKept.MaxCreatedAt, lastKept.BatchRunId),
      hasMore: true,
    };
  }

  /**
   * Newest UpdatedAt across every live run, for the cheap change check. Reads
   * the same rows the page reads; an agent test run is excluded here too
   * since it never reaches the page and would report a phantom change.
   */
  private async readMaxUpdatedAt(projectId: string): Promise<number> {
    const tsRows = await this.queryRows<{ LastUpdatedAt: string }>(
      `SELECT toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastUpdatedAt
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ArchivedAt IS NULL
         ${AGENT_TEST_SET_EXCLUSION}`,
      { tenantId: projectId },
    );
    return Number(tsRows[0]?.LastUpdatedAt ?? "0");
  }

  /**
   * One page of batch ids, newest first, cursor + date filter applied. NOTE:
   * aliased as NormalizedSetId, not ScenarioSetId, on purpose — aliasing as
   * ScenarioSetId would shadow the dedup IN-tuple's column and ClickHouse would reject the query.
   */
  private async selectBatchPage({
    projectId,
    decoded,
    startDate,
    endDate,
    fetchLimit,
  }: {
    projectId: string;
    decoded: CursorPayload | null;
    startDate?: number;
    endDate?: number;
    fetchLimit: number;
  }): Promise<{ BatchRunId: string; MaxCreatedAt: string; NormalizedSetId: string }[]> {
    const cursorPredicate = decoded
      ? `(
          (toString(toUnixTimestamp64Milli(max(CreatedAt))) < {cursorTs:String})
          OR (toString(toUnixTimestamp64Milli(max(CreatedAt))) = {cursorTs:String} AND BatchRunId > {cursorBatchRunId:String})
        )`
      : "1 = 1";

    const dateFilter = SimulationClickHouseRepository.buildDateFilter({ startDate, endDate });

    const combinedHaving = `HAVING ${[cursorPredicate, dateFilter.havingClause].filter(Boolean).join(" AND ")}`;

    return await this.queryRows<{
      BatchRunId: string;
      MaxCreatedAt: string;
      NormalizedSetId: string;
    }>(
      `SELECT
        BatchRunId,
        toString(toUnixTimestamp64Milli(max(CreatedAt))) AS MaxCreatedAt,
        any(IF(ScenarioSetId = '', 'default', ScenarioSetId)) AS NormalizedSetId -- Must match DEFAULT_SET_ID from internal-set-id.ts
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${AGENT_TEST_SET_EXCLUSION}
         ${SimulationClickHouseRepository.simulationRunDedupPredicate(`TenantId = {tenantId:String} ${dateFilter.whereClause}`)}
       GROUP BY BatchRunId
       ${combinedHaving}
       ORDER BY MaxCreatedAt DESC, BatchRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        ...(decoded ? { cursorTs: decoded.ts, cursorBatchRunId: decoded.batchRunId } : {}),
        ...dateFilter.params,
        fetchLimit: String(fetchLimit),
      },
    );
  }

  /**
   * Stops a full-message page at a batch boundary and moves the cursor to the
   * last batch that was kept.
   */
  private capPageAtBatchBoundary({
    runs,
    pageRows,
    nextCursor,
    hasMore,
  }: {
    runs: SimulationRunData[];
    pageRows: { BatchRunId: string; MaxCreatedAt: string }[];
    nextCursor?: string;
    hasMore: boolean;
  }): { runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean } {
    const capped = SimulationClickHouseRepository.capRunsAtBatchBoundary({
      runs,
      batchRunIds: pageRows.map((row) => row.BatchRunId),
      ceiling: FULL_MESSAGES_PAGE_LIMIT,
    });
    const cutShort = capped.batchesKept < pageRows.length;
    const lastKept = pageRows[capped.batchesKept - 1];
    return {
      runs: capped.runs,
      nextCursor:
        cutShort && lastKept
          ? this.encodeCursor(lastKept.MaxCreatedAt, lastKept.BatchRunId)
          : nextCursor,
      hasMore: cutShort ? true : hasMore,
    };
  }

  async getRunDataForAllSuites({
    projectId,
    limit = 20,
    cursor,
    startDate,
    endDate,
    sinceTimestamp,
    shouldIncludeMessages = false,
  }: {
    projectId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
    sinceTimestamp?: number;
    shouldIncludeMessages?: boolean;
  }): Promise<
    | { changed: false; lastUpdatedAt: number }
    | {
        changed: true;
        lastUpdatedAt: number;
        runs: SimulationRunData[];
        scenarioSetIds: Record<string, string>;
        nextCursor?: string;
        hasMore: boolean;
      }
  > {
    // Cheap timestamp check: skip heavy query if nothing changed
    if (sinceTimestamp !== undefined) {
      const lastUpdatedAt = await this.readMaxUpdatedAt(projectId);
      if (lastUpdatedAt <= sinceTimestamp) {
        return { changed: false, lastUpdatedAt };
      }
    }

    const validatedLimit = SimulationClickHouseRepository.clampPageLimit({
      limit,
      shouldIncludeMessages,
    });
    const decoded = cursor ? this.decodeCursor(cursor) : null;

    const batchRows = await this.selectBatchPage({
      projectId,
      decoded,
      startDate,
      endDate,
      fetchLimit: validatedLimit + 1,
    });

    const hasMore = batchRows.length > validatedLimit;
    const pageRows = hasMore ? batchRows.slice(0, validatedLimit) : batchRows;

    if (pageRows.length === 0) {
      return {
        changed: true,
        lastUpdatedAt: 0,
        runs: [],
        scenarioSetIds: {},
        nextCursor: undefined,
        hasMore: false,
      };
    }

    const lastRow = pageRows[pageRows.length - 1]!;
    const nextCursor = hasMore
      ? this.encodeCursor(lastRow.MaxCreatedAt, lastRow.BatchRunId)
      : undefined;

    const scenarioSetIds: Record<string, string> = {};
    for (const row of pageRows) {
      scenarioSetIds[row.BatchRunId] = row.NormalizedSetId;
    }

    const batchRunIds = pageRows.map((r) => r.BatchRunId);
    const runs = await this.getRunsForBatchIds({
      projectId,
      batchRunIds,
      shouldIncludeMessages,
    });
    const lastUpdatedAt = runs.reduce((max, r) => Math.max(max, r.timestamp), 0);

    if (!shouldIncludeMessages) {
      return {
        changed: true,
        lastUpdatedAt,
        runs,
        scenarioSetIds,
        nextCursor,
        hasMore,
      };
    }

    return {
      changed: true,
      lastUpdatedAt,
      scenarioSetIds,
      ...this.capPageAtBatchBoundary({ runs, pageRows, nextCursor, hasMore }),
    };
  }

  async findLastUpdatedAt({
    projectId,
    scenarioSetId,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number> {
    // Freshness probes poll frequently, so an unbounded StartedAt window
    // (scanning every partition, including cold storage) is never acceptable
    // here — floor the window at 30 days when the caller omits it.
    const dateFilter = SimulationClickHouseRepository.buildDateFilter({
      startDate: startDate ?? Date.now() - 30 * 24 * 60 * 60 * 1000,
      endDate,
    });
    const setFilter = scenarioSetId ? "AND ScenarioSetId IN ({scenarioSetIds:Array(String)})" : "";

    // max(UpdatedAt) over all versions equals the latest version's UpdatedAt
    // (ReplacingMergeTree version column), so no dedup subquery is needed.
    // Reads only light columns; the StartedAt window prunes partitions.
    const rows = await this.queryRows<{ LastUpdatedAt: string | null }>(
      `SELECT toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastUpdatedAt
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         ${setFilter}
         ${dateFilter.whereClause}`,
      {
        tenantId: projectId,
        ...(scenarioSetId
          ? { scenarioSetIds: SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId) }
          : {}),
        ...dateFilter.params,
      },
    );

    return Number(rows[0]?.LastUpdatedAt ?? "0");
  }

  async getExternalSetSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationExternalSetSummary[]> {
    return this.getSetSummaries({ ...params, filter: "external" });
  }

  async getInternalSuiteSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationExternalSetSummary[]> {
    return this.getSetSummaries({ ...params, filter: "internal-suites" });
  }

  /**
   * ⚠️  KEEP IN SYNC: the content panel computes pass rate on the frontend
   * with its own formula (passed / settled, excluding in-progress/queued).
   * Update run-history-transforms.ts → computeGroupSummary() too.
   */
  private async getSetSummaries({
    projectId,
    startDate,
    endDate,
    filter,
  }: {
    projectId: string;
    startDate?: number;
    endDate?: number;
    filter: "external" | "internal-suites";
  }): Promise<SimulationExternalSetSummary[]> {
    const dateFilter = SimulationClickHouseRepository.buildDateFilter({ startDate, endDate });

    const havingClause = dateFilter.havingClause ? `HAVING ${dateFilter.havingClause}` : "";

    const wherePredicate =
      filter === "external"
        ? "AND NOT startsWith(ScenarioSetId, '__internal__')"
        : "AND startsWith(ScenarioSetId, '__internal__') AND endsWith(ScenarioSetId, '__suite')";

    // External sets normalize empty ScenarioSetId to 'default'
    const selectId =
      filter === "external"
        ? "IF(ScenarioSetId = '', 'default', ScenarioSetId) AS NormalizedSetId"
        : "ScenarioSetId AS NormalizedSetId";

    const rows = await this.queryRows<{
      ScenarioSetId: string;
      TotalCount: string;
      PassCount: string;
      FailCount: string;
      LastRunAt: string;
    }>(
      `SELECT
        NormalizedSetId AS ScenarioSetId,
        toString(argMax(SettledCount, MinStartedAtMs)) AS TotalCount,
        toString(argMax(PassCount, MinStartedAtMs)) AS PassCount,
        toString(argMax(FailCount, MinStartedAtMs)) AS FailCount,
        toString(max(MinStartedAtMs)) AS LastRunAt
       FROM (
         SELECT
           NormalizedSetId,
           BatchRunId,
           -- Settled = all terminal states (excludes in-progress/queued)
           countIf(Status NOT IN ('IN_PROGRESS', 'PENDING', 'QUEUED', 'RUNNING')) AS SettledCount,
           countIf(Status = 'SUCCESS') AS PassCount,
           countIf(Status IN ('FAILED','FAILURE','ERROR','STALLED','CANCELLED')) AS FailCount,
           -- Use min(StartedAt) to match frontend's minTimestamp (batch creation time)
           toUnixTimestamp64Milli(min(if(StartedAt IS NOT NULL, StartedAt, CreatedAt))) AS MinStartedAtMs
         FROM (
           SELECT ${selectId}, BatchRunId, Status, CreatedAt, StartedAt, ArchivedAt
           FROM ${TABLE_NAME}
           WHERE TenantId = {tenantId:String}
             ${wherePredicate}
             ${dateFilter.whereClause}
             ${SimulationClickHouseRepository.simulationRunDedupPredicate(`TenantId = {tenantId:String} ${wherePredicate} ${dateFilter.whereClause}`)}
         )
         WHERE ArchivedAt IS NULL
         GROUP BY NormalizedSetId, BatchRunId
         ${havingClause}
       )
       GROUP BY NormalizedSetId
       ORDER BY LastRunAt DESC`,
      { tenantId: projectId, ...dateFilter.params },
    );

    return rows.map((row) => ({
      scenarioSetId: row.ScenarioSetId,
      passedCount: Number(row.PassCount),
      failedCount: Number(row.FailCount),
      totalCount: Number(row.TotalCount),
      lastRunTimestamp: Number(row.LastRunAt),
    }));
  }

  /**
   * Latest run result per scenario in the window, for the scenarios table's
   * last-result cells. "Latest" via argMax(UpdatedAt) on deduped runs; the
   * dedup subquery keeps ArchivedAt honest since older versions carry NULL.
   */
  async getLastResultSummaries({
    projectId,
    scenarioIds,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioIds?: string[];
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationLastResultSummary[]> {
    if (scenarioIds !== undefined && scenarioIds.length === 0) {
      return [];
    }
    const dateFilter = SimulationClickHouseRepository.buildDateFilter({ startDate, endDate });
    const scenarioFilter =
      scenarioIds !== undefined ? "AND ScenarioId IN ({scenarioIds:Array(String)})" : "";
    const whereFilters = `TenantId = {tenantId:String} AND ScenarioId != '' ${scenarioFilter} ${dateFilter.whereClause} ${AGENT_TEST_SET_EXCLUSION}`;

    const rows = await this.queryRows<{
      ScenarioId: string;
      LastStatus: string;
      MetCriteriaCount: string;
      UnmetCriteriaCount: string;
      LastRunAt: string;
      LastBatchRunId: string;
      LastScenarioSetId: string;
      LastDurationMs: string;
      LastTotalCost: string;
    }>(
      // Duration and cost ride the same argMax as the verdict, stringified
      // with '' for NULL first: an aggregate over the raw Nullable column
      // would skip NULL rows and serve an older run's value for a latest run
      // that has none yet.
      `SELECT
        ScenarioId,
        argMax(Status, UpdatedAt)                                   AS LastStatus,
        toString(argMax(length(MetCriteria), UpdatedAt))            AS MetCriteriaCount,
        toString(argMax(length(UnmetCriteria), UpdatedAt))          AS UnmetCriteriaCount,
        toString(toUnixTimestamp64Milli(max(ifNull(StartedAt, CreatedAt)))) AS LastRunAt,
        argMax(BatchRunId, UpdatedAt)                               AS LastBatchRunId,
        argMax(ScenarioSetId, UpdatedAt)                            AS LastScenarioSetId,
        argMax(ifNull(toString(DurationMs), ''), UpdatedAt)         AS LastDurationMs,
        argMax(ifNull(toString(TotalCost), ''), UpdatedAt)          AS LastTotalCost
       FROM (
         SELECT ScenarioId, Status, MetCriteria, UnmetCriteria, BatchRunId,
                ScenarioSetId, DurationMs, TotalCost,
                StartedAt, CreatedAt, UpdatedAt, ArchivedAt
         FROM ${TABLE_NAME}
         WHERE ${whereFilters}
           ${SimulationClickHouseRepository.simulationRunDedupPredicate(whereFilters)}
       )
       WHERE ArchivedAt IS NULL
       GROUP BY ScenarioId`,
      {
        tenantId: projectId,
        ...(scenarioIds !== undefined ? { scenarioIds } : {}),
        ...dateFilter.params,
      },
    );

    return rows.map((row) => ({
      scenarioId: row.ScenarioId,
      status: mapStatus(row.LastStatus),
      metCriteriaCount: Number(row.MetCriteriaCount),
      unmetCriteriaCount: Number(row.UnmetCriteriaCount),
      lastRunAt: Number(row.LastRunAt),
      batchRunId: row.LastBatchRunId,
      scenarioSetId: row.LastScenarioSetId,
      durationInMs: row.LastDurationMs === "" ? null : Number(row.LastDurationMs),
      totalCost: row.LastTotalCost === "" ? null : Number(row.LastTotalCost),
    }));
  }

  async findAllRunIdsForSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<{ runIds: string[]; reachedCap: boolean }> {
    const client = await this.getClient(projectId);
    // The default set is stored as '' but addressed as 'default' (and
    // vice-versa). Expand to both storage forms so archiving the default
    // set matches its rows — the same normalization every other set-scoped
    // query uses via expandSetIdFilter.
    const scenarioSetIds = SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId);
    // Dedup to the latest version per run before applying ArchivedAt IS NULL.
    // simulation_runs is ReplacingMergeTree(UpdatedAt); without dedup, an
    // older non-archived row can satisfy the filter even after the run was
    // archived, re-dispatching deletions for already-archived runs.
    const result = await client.query({
      query: `SELECT DISTINCT ScenarioRunId
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
                AND ArchivedAt IS NULL
                ${SimulationClickHouseRepository.simulationRunDedupPredicate(
                  "TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)})",
                )}
              LIMIT ${RUN_ID_CAP}`,
      query_params: { tenantId: projectId, scenarioSetIds },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ ScenarioRunId: string }>();
    const runIds = rows.map((r) => r.ScenarioRunId);
    return { runIds, reachedCap: runIds.length === RUN_ID_CAP };
  }

  async getDistinctExternalSetIds({ projectIds }: { projectIds: string[] }): Promise<Set<string>> {
    const [firstProjectId] = projectIds;
    if (!firstProjectId) {
      return new Set();
    }

    // simulation_runs is a ReplacingMergeTree; fold each run to its latest
    // version in one GROUP BY (light columns only) rather than the two-scan
    // IN-tuple dedup. Folds on `argMax(ArchivedAt IS NULL, UpdatedAt)`, not
    // `argMax(ArchivedAt, ...)`, since argMax skips NULL-first-arg rows and
    // would otherwise miss a freshly un-archived run's true latest version.
    const rows = await this.queryRows<{ ScenarioSetId: string }>(
      `SELECT DISTINCT IF(ScenarioSetId = '', '${DEFAULT_SET_ID}', ScenarioSetId) AS ScenarioSetId
       FROM (
         SELECT
           ScenarioSetId,
           argMax(ArchivedAt IS NULL, UpdatedAt) AS latestIsActive
         FROM ${TABLE_NAME}
         WHERE TenantId IN ({projectIds:Array(String)})
           AND NOT startsWith(ScenarioSetId, '${INTERNAL_SET_PREFIX}')
         GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE latestIsActive`,
      { tenantId: firstProjectId, projectIds },
    );

    return new Set(rows.map((r) => (r.ScenarioSetId === "" ? DEFAULT_SET_ID : r.ScenarioSetId)));
  }

  // ---- Export sweep ----

  async countRunsForExport({
    projectId,
    scenarioSetId,
    scenarioId,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number> {
    const { stableClause, dateClause, params } = this.buildExportFilters({
      scenarioSetId,
      scenarioId,
      startDate,
      endDate,
    });

    const rows = await this.queryRows<{ Total: string }>(
      `SELECT toString(count()) AS Total
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         ${stableClause}
         ${dateClause}
         AND t.ArchivedAt IS NULL
         ${SimulationClickHouseRepository.qualifiedDedupPredicate(`TenantId = {tenantId:String} ${SimulationClickHouseRepository.unqualify(stableClause)}`)}`,
      { tenantId: projectId, ...params },
    );

    return Number(rows[0]?.Total ?? "0");
  }

  /**
   * Forward-only page for a CSV export sweep — distinct from
   * getRunDataForAllSuites (capped, freshness-shaped); an export needs a plain
   * chronological sweep to exhaustion via keyset (not OFFSET) pagination on (StartedAt, ScenarioRunId), reading RUN_COLUMNS (never LIST_COLUMNS, which nulls Reasoning/Error).
   */
  async findRunsForExport({
    projectId,
    scenarioSetId,
    scenarioId,
    startDate,
    endDate,
    limit,
    cursor,
  }: {
    projectId: string;
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
    limit: number;
    cursor?: string;
  }): Promise<{
    runs: SimulationExportRun[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const validatedLimit = Math.min(Math.max(1, limit), 500);
    const decoded = cursor ? this.decodeExportCursor(cursor) : null;

    const { stableClause, dateClause, params } = this.buildExportFilters({
      scenarioSetId,
      scenarioId,
      startDate,
      endDate,
    });

    const cursorPredicate = decoded
      ? `AND (
          (${EXPORT_SORT_KEY} > toUInt64({cursorTs:String}))
          OR (${EXPORT_SORT_KEY} = toUInt64({cursorTs:String}) AND t.ScenarioRunId > {cursorRunId:String})
        )`
      : "";

    const rows = await this.queryRows<ClickHouseSimulationRunRow & { ExportSortKey: string }>(
      `SELECT ${RUN_COLUMNS},
        toString(${EXPORT_SORT_KEY}) AS ExportSortKey
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         ${stableClause}
         ${dateClause}
         ${cursorPredicate}
         AND t.ArchivedAt IS NULL
         ${SimulationClickHouseRepository.qualifiedDedupPredicate(`TenantId = {tenantId:String} ${SimulationClickHouseRepository.unqualify(stableClause)}`)}
       ORDER BY ${EXPORT_SORT_KEY} ASC, t.ScenarioRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        ...params,
        ...(decoded ? { cursorTs: decoded.ts, cursorRunId: decoded.scenarioRunId } : {}),
        fetchLimit: String(validatedLimit + 1),
      },
    );

    const hasMore = rows.length > validatedLimit;
    const pageRows = hasMore ? rows.slice(0, validatedLimit) : rows;

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? this.encodeExportCursor(lastRow.ExportSortKey, lastRow.ScenarioRunId)
        : undefined;

    return {
      runs: pageRows.map((row) => ({
        ...mapClickHouseRowToScenarioRunData(row),
        scenarioSetId: row.ScenarioSetId === "" ? DEFAULT_SET_ID : row.ScenarioSetId,
        traceIds: row.TraceIds ?? [],
      })),
      nextCursor,
      hasMore,
    };
  }

  /**
   * Keeps export rows and their count on one filter definition. StartedAt
   * range applies only after the latest version wins (it changes between
   * row versions); outcome filtering stays after mapping (run history's derived categories).
   */
  private buildExportFilters({
    scenarioSetId,
    scenarioId,
    startDate,
    endDate,
  }: {
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
  }): {
    stableClause: string;
    dateClause: string;
    params: Record<string, string | string[]>;
  } {
    const stableParts: string[] = [];
    const params: Record<string, string | string[]> = {};

    if (scenarioSetId) {
      stableParts.push("t.ScenarioSetId IN ({exportSetIds:Array(String)})");
      params.exportSetIds = SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId);
    }

    if (scenarioId) {
      stableParts.push("t.ScenarioId = {exportScenarioId:String}");
      params.exportScenarioId = scenarioId;
    }

    const dateFilter = SimulationClickHouseRepository.buildDateFilter({ startDate, endDate });
    let dateClause = "";
    if (dateFilter.whereClause) {
      // buildDateFilter emits unqualified column names; the export queries read
      // through the `t` alias, so qualify them here.
      dateClause = dateFilter.whereClause.replace(/StartedAt/g, "t.StartedAt");
      Object.assign(params, dateFilter.params);
    }

    return {
      stableClause: stableParts.length > 0 ? `AND ${stableParts.join(" AND ")}` : "",
      dateClause,
      params,
    };
  }

  // ---- Cursor helpers ----

  /**
   * Export cursors key on (StartedAt, ScenarioRunId); the batch cursors below
   * key on (max(CreatedAt), BatchRunId). Separate encoders rather than one
   * shared pair so neither payload carries a field named for the other's key.
   */
  private encodeExportCursor(ts: string, scenarioRunId: string): string {
    return Buffer.from(JSON.stringify({ ts, scenarioRunId })).toString("base64");
  }

  private decodeExportCursor(cursor: string): { ts: string; scenarioRunId: string } | null {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8")) as Record<
        string,
        unknown
      >;
      if (typeof parsed.ts !== "string" || typeof parsed.scenarioRunId !== "string") {
        return null;
      }
      return { ts: parsed.ts, scenarioRunId: parsed.scenarioRunId };
    } catch {
      return null;
    }
  }

  private encodeCursor(ts: string, batchRunId: string): string {
    const payload: CursorPayload = { ts, batchRunId };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  private decodeCursor(cursor: string): CursorPayload | null {
    try {
      const json = Buffer.from(cursor, "base64").toString("utf-8");
      const parsed = JSON.parse(json) as Record<string, unknown>;
      if (typeof parsed.ts !== "string" || typeof parsed.batchRunId !== "string") {
        return null;
      }
      return { ts: parsed.ts, batchRunId: parsed.batchRunId };
    } catch {
      return null;
    }
  }

  // ---- Batch helper ----

  private async getRunsForBatchIds({
    projectId,
    batchRunIds,
    scenarioSetId,
    shouldIncludeMessages = false,
  }: {
    projectId: string;
    batchRunIds: string[];
    scenarioSetId?: string;
    /**
     * Reads the full message arrays instead of the trimmed list projection.
     * Heavy: only for a caller that asked for whole conversations, and only
     * with the page size already capped by FULL_MESSAGES_PAGE_LIMIT.
     */
    shouldIncludeMessages?: boolean;
  }): Promise<SimulationRunData[]> {
    if (batchRunIds.length === 0) return [];

    const setFilter = scenarioSetId
      ? "AND t.ScenarioSetId IN ({scenarioSetIds:Array(String)})"
      : "";
    const innerSetFilter = scenarioSetId
      ? "AND ScenarioSetId IN ({scenarioSetIds:Array(String)})"
      : "";

    const rows = await this.queryRows<ClickHouseSimulationRunRow>(
      `SELECT ${shouldIncludeMessages ? RUN_COLUMNS : LIST_COLUMNS}
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         AND t.BatchRunId IN ({batchRunIds:Array(String)})
         ${setFilter}
         AND t.ArchivedAt IS NULL
         AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
           SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
           FROM ${TABLE_NAME}
           WHERE TenantId = {tenantId:String}
             AND BatchRunId IN ({batchRunIds:Array(String)})
             ${innerSetFilter}
           GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
         )
       ORDER BY CreatedAt ASC
       LIMIT 5000`,
      {
        tenantId: projectId,
        batchRunIds,
        ...(scenarioSetId
          ? { scenarioSetIds: SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId) }
          : {}),
      },
    );

    return rows.map((row) => mapClickHouseRowToScenarioRunData(row));
  }

  private static expandSetIdFilter(scenarioSetId: string): string[] {
    return scenarioSetId === DEFAULT_SET_ID || scenarioSetId === ""
      ? [DEFAULT_SET_ID, ""]
      : [scenarioSetId];
  }

  /**
   * Maps a batch aggregate row to the shared summary counts. stalledCount and
   * note stay out: the history page reads them from its own preview items,
   * the single-batch summary from its own aggregate/StalledCount column.
   */
  private static mapBatchAggregateRow(
    row: BatchAggregateRow,
  ): Omit<SimulationBatchSummary, "stalledCount" | "note" | "startedBy"> {
    const firstCompletedAt = Number(row.FirstCompletedAt);
    const allCompletedAt = Number(row.AllCompletedAt);

    return {
      batchRunId: row.BatchRunId,
      totalCount: Number(row.TotalCount),
      passCount: Number(row.PassCount),
      failCount: Number(row.FailCount),
      runningCount: Number(row.RunningCount),
      settledCount: Number(row.SettledCount),
      lastRunAt: Number(row.LastRunAt),
      lastUpdatedAt: Number(row.LastUpdatedAt),
      firstCompletedAt: firstCompletedAt > 0 ? firstCompletedAt : null,
      allCompletedAt: allCompletedAt > 0 ? allCompletedAt : null,
    };
  }

  /**
   * IN-tuple dedup for simulation_runs, resolved with lightweight key columns only.
   * @param whereFilters - duplicated here for inner-subquery partition pruning.
   * @see dev/docs/best_practices/clickhouse-queries.md — "Safe Pattern: IN-Tuple Dedup"
   */
  private static simulationRunDedupPredicate(whereFilters: string): string {
    return `AND (TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, UpdatedAt) IN (
      SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
      FROM ${TABLE_NAME}
      WHERE ${whereFilters}
      GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
    )`;
  }

  /**
   * Dedup predicate for a query reading simulation_runs through the `t`
   * alias — outer columns MUST be `t.`-qualified, since RUN_COLUMNS aliases
   * timestamps to strings and an unqualified column silently matches zero rows (String vs DateTime64) instead of erroring.
   */
  private static qualifiedDedupPredicate(whereFilters: string): string {
    return `AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
      SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
      FROM ${TABLE_NAME}
      WHERE ${whereFilters}
      GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
    )`;
  }

  /**
   * Strips the `t.` qualifier for reuse inside the dedup subquery, which selects
   * from the bare table and has no such alias in scope.
   */
  private static unqualify(clause: string): string {
    return clause.replace(/\bt\./g, "");
  }

  /**
   * Date filter clauses: `whereClause` filters StartedAt for partition
   * pruning (simulation_runs is partitioned by toYearWeek(StartedAt); without
   * it ClickHouse scans cold storage too), `havingClause` filters max(CreatedAt) post-aggregation for exact edge cases.
   */
  private static buildDateFilter({
    startDate,
    endDate,
  }: {
    startDate?: number;
    endDate?: number;
  }): {
    havingClause: string | null;
    whereClause: string;
    params: Record<string, string>;
  } {
    const havingParts: string[] = [];
    const whereParts: string[] = [];
    const params: Record<string, string> = {};
    if (startDate !== undefined) {
      havingParts.push("toUnixTimestamp64Milli(max(CreatedAt)) >= toUInt64({startDateMs:String})");
      whereParts.push("StartedAt >= fromUnixTimestamp64Milli(toUInt64({startDateMs:String}))");
      params.startDateMs = String(startDate);
    }
    if (endDate !== undefined) {
      havingParts.push("toUnixTimestamp64Milli(max(CreatedAt)) <= toUInt64({endDateMs:String})");
      whereParts.push("StartedAt <= fromUnixTimestamp64Milli(toUInt64({endDateMs:String}))");
      params.endDateMs = String(endDate);
    }
    return {
      havingClause: havingParts.length > 0 ? havingParts.join(" AND ") : null,
      whereClause: whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "",
      params,
    };
  }
}
