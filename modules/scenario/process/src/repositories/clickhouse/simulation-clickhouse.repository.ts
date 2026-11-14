import { Buffer } from "node:buffer";

import {
  type ClickHouseQueryClient,
  type IdBoundOptions,
  queryWindowed,
  type WindowFragment,
} from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  column,
  type ConditionOps,
  fn,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import {
  AGENT_TEST_SET_SUFFIX,
  RUN_ACTOR_LABELS,
  type RecordedRunActor,
  VOICE_CALL_SCENARIO_SET_ID,
  SimulationRunStatus,
  type SimulationBatchHistory,
  type SimulationBatchSummary,
  type SimulationExternalSetSummary,
  type SimulationLastResultSummary,
  type SimulationRunData,
  type SimulationSetData,
  type SimulationExportRun,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

import { SimulationRepository } from "../simulation.repository.ts";
import { simulationRuns } from "./clickhouse.simulation-runs.table.ts";
import {
  type ClickHouseSimulationRunRow,
  mapClickHouseRowToScenarioRunData,
  mapStatus,
} from "./simulation-run.mapper.ts";

const DEFAULT_SET_ID = "default";
const INTERNAL_SET_PREFIX = "__internal__";

export const TABLE_NAME = "simulation_runs" as const;

export const RUN_ID_CAP = 10000;

/** How the set and batch reads' id bounds read their window; a caller's date range stays beside. */
const ID_BOUND_READ: { idBound: IdBoundOptions } = { idBound: { fallback: "unbounded" } };

/**
 * Sort key for export sweep: ORDER BY, cursor predicate and returned cursor must align or
 * silently drops/repeats boundary runs. Coalesces NULL StartedAt preventing row stranding.
 */
const exportSortKey = fn.toUnixTimestamp64Milli(
  fn.ifNull(simulationRuns.StartedAt, simulationRuns.CreatedAt),
);

/** The keys of {@link batchAggregateFields}. SettledCount is every run not running. */
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

/** A row of {@link batchAggregateFields}: a UInt64 count may arrive as a string. */
type BuiltBatchAggregateRow = { BatchRunId: string } & {
  [Key in Exclude<keyof BatchAggregateRow, "BatchRunId">]: string | number;
};

type RunConditionOps = ConditionOps<typeof simulationRuns.$table.name, Record<never, never>>;

/**
 * Every status a run carries while the batch still owes work: QUEUED and
 * RUNNING belong beside PENDING/IN_PROGRESS since the queue writes them and
 * a batch holding any of the four is not finished.
 */
const RUNNING_STATUS_LIST = ["IN_PROGRESS", "PENDING", "PENDING_EVALUATION", "QUEUED", "RUNNING"];
const FAILED_STATUS_LIST = ["FAILED", "FAILURE", "ERROR", "CANCELLED"];
const COMPLETED_STATUS_LIST = ["SUCCESS", ...FAILED_STATUS_LIST];
/** A set summary counts a stalled run failed; a batch's own counts keep it apart. */
const SUMMARY_FAILED_STATUS_LIST = [...FAILED_STATUS_LIST, "STALLED"];
const INTERNAL_SUITE_SUFFIX = "__suite";

/** A run's set id, the default set's stored `""` read as {@link DEFAULT_SET_ID}. */
const normalizedSetId = fn.if(
  fn.notEmpty(simulationRuns.ScenarioSetId),
  simulationRuns.ScenarioSetId,
  DEFAULT_SET_ID,
);

/**
 * Leaves out runs that are not results of a scenario: "Test agent" one-off
 * checks, and the legacy `voice-calls` set pre-#8020 drawer calls landed in.
 * Hidden from every list; a direct link to an old run still opens by id.
 */
function notAgentTestRun({ and, ne, not }: RunConditionOps) {
  return and(
    not(fn.endsWith(simulationRuns.ScenarioSetId, AGENT_TEST_SET_SUFFIX)),
    ne(simulationRuns.ScenarioSetId, VOICE_CALL_SCENARIO_SET_ID),
  );
}

/** Which sets a summary lists: every external set but agent tests, or the internal suites. */
function setSummaryFilter(filter: SetSummaryFilter, ops: RunConditionOps) {
  const setId = simulationRuns.ScenarioSetId;
  return filter === "external"
    ? ops.and(ops.not(fn.startsWith(setId, INTERNAL_SET_PREFIX)), notAgentTestRun(ops))
    : ops.and(fn.startsWith(setId, INTERNAL_SET_PREFIX), fn.endsWith(setId, INTERNAL_SUITE_SUFFIX));
}

type SetSummaryFilter = "external" | "internal-suites";

/**
 * A metadata string under `path`, `''` when absent, read server-side so only it crosses the wire.
 * @see specs/suites/run-note-metadata-convention.feature (the note)
 * @see specs/scenarios/run-actor-on-runs.feature (the actor id/label pair; empty id: no person)
 */
const metadataString = (...path: string[]) =>
  fn.JSONExtractString(fn.ifNull(simulationRuns.Metadata, "{}"), ...path);

/**
 * A run whose setup did not answer is not scored and leaves every pass rate (ADR-180), the rule
 * `isRunNotScored` applies in the browser. Such a run always finishes ERROR, so the status test
 * goes first and only those rows pay for reading the metadata.
 */
function runNotScored({ and, eq, not, oneOf }: RunConditionOps) {
  return and(
    eq(simulationRuns.Status, "ERROR"),
    not(oneOf(metadataString("langwatch", "hooks", "setup", "status"), ["", "ok"])),
  );
}

/** A batch's counts and times over its runs' latest versions; PENDING_EVALUATION is running. */
function batchAggregateFields(ops: RunConditionOps) {
  const { and, eq, not, oneOf } = ops;
  const t = simulationRuns;
  const running = oneOf(t.Status, RUNNING_STATUS_LIST);
  const millis = fn.toUnixTimestamp64Milli;
  return {
    BatchRunId: t.BatchRunId,
    TotalCount: fn.count(),
    PassCount: fn.countIf(eq(t.Status, "SUCCESS")),
    FailCount: fn.countIf(and(oneOf(t.Status, FAILED_STATUS_LIST), not(runNotScored(ops)))),
    RunningCount: fn.countIf(running),
    SettledCount: fn.countIf(not(running)),
    StalledCount: fn.countIf(eq(t.Status, "STALLED")),
    LastUpdatedAt: millis(fn.max(t.UpdatedAt)),
    LastRunAt: millis(fn.max(t.CreatedAt)),
    FirstCompletedAt: millis(fn.minIf(t.UpdatedAt, oneOf(t.Status, COMPLETED_STATUS_LIST))),
    AllCompletedAt: fn.if(eq(fn.countIf(running), 0), millis(fn.max(t.UpdatedAt)), 0),
    MinStartedAt: millis(fn.min(t.StartedAt)),
    MaxStartedAt: millis(fn.max(t.StartedAt)),
  };
}

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
function deriveRunActor(params: {
  id: string | null | undefined;
  label: string | null | undefined;
}): RecordedRunActor | null {
  if (!params.id) return null;
  const label = RUN_ACTOR_LABELS.find((known) => known === params.label);
  return label ? { id: params.id, label } : null;
}

interface CursorPayload {
  ts: string;
  batchRunId: string;
}

/** One tenant's session: every read is a built statement naming its own scope (ADR-202). */
export type SimulationClickHouseClient = {
  /** A statement the typed builder built; it names its own tenant scope. */
  read: ClickHouseQueryClient["read"];
  /** Which columns of a table this tenant's target holds, for `fn.heldOr`. */
  holds(input: { table: string }): Promise<(name: string) => boolean>;
};

type SimulationClickHouseClientResolver = (tenantId: string) => Promise<SimulationClickHouseClient>;

/** A tenant's session per one-project read; the plain reader only for a declared project set. */
type SimulationClickHouseClients = Readonly<{
  sessions: SimulationClickHouseClientResolver;
  /** Sends `tenantScope.set` reads over one organization's projects, which the caller holds. */
  clickhouse: Pick<ClickHouseQueryClient, "read">;
}>;

export class SimulationClickHouseRepository extends SimulationRepository {
  static create(clients: SimulationClickHouseClients): SimulationClickHouseRepository {
    return new SimulationClickHouseRepository(clients);
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

  static computeStartedAtBoundsForPage(
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

  readonly #resolveClient: SimulationClickHouseClientResolver;
  readonly #setReads: Pick<ClickHouseQueryClient, "read">;

  private constructor({ sessions, clickhouse }: SimulationClickHouseClients) {
    super();
    this.#resolveClient = sessions;
    this.#setReads = clickhouse;
  }

  /** Guards against empty/missing tenantId before delegating to the injected resolver. */
  private async getClient(tenantId: string): Promise<SimulationClickHouseClient> {
    if (!tenantId) {
      throw new Error("tenantId is required for ClickHouse client resolution");
    }
    return this.#resolveClient(tenantId);
  }

  async findScenarioSetsData({
    projectId,
    startDate,
    endDate,
  }: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationSetData[]> {
    const client = await this.getClient(projectId);
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.setsListRead({ projectId, startDate, endDate }),
      table: simulationRuns.$table.name,
      // As on main: with no start date this lists every set the tenant ever ran.
      ...(startDate === undefined ? { declaresFullScan: true as const } : {}),
    });

    return rows.map((row) => ({
      scenarioSetId: row.NormalizedSetId,
      scenarioCount: Number(row.ScenarioCount),
      lastRunAt: Number(row.LastRunAt),
    }));
  }

  async findScenarioRunData({
    projectId,
    scenarioRunId,
  }: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<SimulationRunData | null> {
    const client = await this.getClient(projectId);
    const holds = await client.holds({ table: simulationRuns.$table.name });
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.scenarioRunRead({
        projectId,
        scenarioRunId,
        holds,
      }),
      table: simulationRuns.$table.name,
      ...ID_BOUND_READ,
    });

    const row = rows[0];
    if (!row) return null;
    return mapClickHouseRowToScenarioRunData(runRowOf(row));
  }

  private static mapPreviewItem(r: PreviewItemRow) {
    const baseStatus = mapStatus(r.Status);
    const durationMs = r.DurationMs != null ? Number(r.DurationMs) : 0;
    const hasFinished = r.FinishedAtMs != null && Number(r.FinishedAtMs) > 0;
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
  }

  async listBatchHistoryForScenarioSet({
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

    const client = await this.getClient(projectId);
    const [totalCountRead, batchRowsRead] = await Promise.all([
      client.read({
        statement: SimulationClickHouseRepository.batchRunCountRead({
          projectId,
          scenarioSetId,
          startDate,
          endDate,
        }),
        table: simulationRuns.$table.name,
        ...ID_BOUND_READ,
      }),
      client.read({
        statement: SimulationClickHouseRepository.batchHistoryPageRead({
          projectId,
          scenarioSetId,
          limit: validatedLimit + 1,
          after: decoded,
          startDate,
          endDate,
        }),
        table: simulationRuns.$table.name,
        ...ID_BOUND_READ,
      }),
    ]);
    const totalCount = Number(totalCountRead.rows[0]?.BatchRunCount ?? 0);
    const batchRows = batchRowsRead.rows;

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
      ? this.encodeCursor(String(lastRow.LastRunAt), lastRow.BatchRunId)
      : undefined;

    const batchRunIds = pageRows.map((r) => r.BatchRunId);

    // Bounds the heavy step-2 read to the page's StartedAt window (from step
    // 1) via queryWindowed so it's metered exactly once (ADR-068): a range
    // runs windowed/hit; no usable range runs unbounded/unwindowed (the old
    // silent widening, now counted). fallback "none": step 1 already bounded
    // these batches, so an empty windowed read is a genuine empty page.
    const startedAtBounds = SimulationClickHouseRepository.computeStartedAtBoundsForPage(
      pageRows.map((row) => ({
        MinStartedAt: String(row.MinStartedAt),
        MaxStartedAt: String(row.MaxStartedAt),
      })),
    );

    // Step 2: fetch slim item rows (preview columns only)
    const itemRows = await queryWindowed<PreviewItemRow[]>({
      table: TABLE_NAME,
      hintMs: startedAtBounds ? (startedAtBounds.minMs + startedAtBounds.maxMs) / 2 : null,
      windowMs: startedAtBounds ? (startedAtBounds.maxMs - startedAtBounds.minMs) / 2 : undefined,
      fallback: "none",
      isEmpty: (rows) => rows.length === 0,
      run: async (window) => {
        const { rows } = await client.read({
          statement: SimulationClickHouseRepository.batchPreviewItemsRead({
            projectId,
            scenarioSetId,
            batchRunIds,
            window,
          }),
          table: simulationRuns.$table.name,
          ...ID_BOUND_READ,
        });
        return rows;
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

      const items = (itemsByBatch.get(b.BatchRunId) ?? []).map((row) =>
        SimulationClickHouseRepository.mapPreviewItem(row),
      );

      const stalledCount = items.filter((i) => i.status === "STALLED").length;

      // Every run of a batch is stamped with the same note at queue time, so
      // the first non-empty one is the batch's note. Reading it here costs no
      // extra query: the preview rows are already loaded.
      const note = (itemsByBatch.get(b.BatchRunId) ?? []).find((r) => r.Note !== "")?.Note ?? null;

      // The actor is stamped on every run of a batch at queue time, the same
      // way the note is, so the first run that names one answers for the
      // batch. It rides the preview rows already loaded, so it costs no query.
      const actorRow = (itemsByBatch.get(b.BatchRunId) ?? []).find((r) => r.ActorId !== "");
      const startedBy = deriveRunActor({
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
  async findBatchSummary({
    projectId,
    batchRunId,
  }: {
    projectId: string;
    batchRunId: string;
  }): Promise<SimulationBatchSummary | null> {
    const client = await this.getClient(projectId);
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.batchSummaryRead({ projectId, batchRunId }),
      table: simulationRuns.$table.name,
      ...ID_BOUND_READ,
    });

    const row = rows[0];
    if (!row) return null;

    return {
      ...SimulationClickHouseRepository.mapBatchAggregateRow(row),
      stalledCount: Number(row.StalledCount),
      note: row.Note === "" ? null : row.Note,
      startedBy: deriveRunActor({ id: row.ActorId, label: row.ActorLabel }),
    };
  }

  async findRunDataForBatchRun({
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
      const client = await this.getClient(projectId);
      const { rows: tsRows } = await client.read({
        statement: SimulationClickHouseRepository.batchLastUpdatedRead({ projectId, batchRunId }),
        table: simulationRuns.$table.name,
        ...ID_BOUND_READ,
      });
      const lastUpdatedAt = Number(tsRows[0]?.LastUpdatedAt ?? "0");
      if (lastUpdatedAt <= sinceTimestamp) {
        return { changed: false, lastUpdatedAt };
      }
    }

    // The batch id identifies the batch within the tenant on its own; the
    // scenario set id narrows the scan when the caller sends one. The CLI's
    // --wait polls with just the batch id. An empty string is a real value
    // that selects the default set, so only an absent id drops the predicate.
    const client = await this.getClient(projectId);
    const holds = await client.holds({ table: simulationRuns.$table.name });
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.batchRunsRead({
        projectId,
        scenarioSetId,
        batchRunId,
        holds,
      }),
      table: simulationRuns.$table.name,
      ...ID_BOUND_READ,
    });

    const runs = rows.map((row) => mapClickHouseRowToScenarioRunData(runRowOf(row)));
    const lastUpdatedAt = runs.reduce((max, r) => Math.max(max, r.timestamp), 0);
    return { changed: true, lastUpdatedAt, runs };
  }

  async findBatchRunCountForScenarioSet({
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
    const client = await this.getClient(projectId);
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.batchRunCountRead({
        projectId,
        scenarioSetId,
        startDate,
        endDate,
      }),
      table: simulationRuns.$table.name,
      ...ID_BOUND_READ,
    });
    return Number(rows[0]?.BatchRunCount ?? 0);
  }

  async findAllRunDataForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<SimulationRunData[]> {
    const client = await this.getClient(projectId);
    const holds = await client.holds({ table: simulationRuns.$table.name });
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.setRunsRead({ projectId, scenarioSetId, holds }),
      table: simulationRuns.$table.name,
      ...ID_BOUND_READ,
    });

    return rows.map((row) => mapClickHouseRowToScenarioRunData(runRowOf(row)));
  }

  async listRunDataForScenarioSet({
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

    const client = await this.getClient(projectId);
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.setBatchPageRead({
        projectId,
        scenarioSetId,
        limit: validatedLimit + 1,
        after: decoded,
        startDate,
        endDate,
      }),
      table: simulationRuns.$table.name,
      ...ID_BOUND_READ,
    });
    const batchRows = rows.map((row) => ({
      BatchRunId: row.BatchRunId,
      MaxCreatedAt: String(row.MaxCreatedAt),
    }));

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
    const client = await this.getClient(projectId);
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.maxUpdatedAtRead({ projectId }),
      table: simulationRuns.$table.name,
    });
    return Number(rows[0]?.LastUpdatedAt ?? 0);
  }

  /** One page of batch ids across every set, newest first, cursor and date range applied. */
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
    const client = await this.getClient(projectId);
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.suitesBatchPageRead({
        projectId,
        limit: fetchLimit,
        after: decoded,
        startDate,
        endDate,
      }),
      table: simulationRuns.$table.name,
    });
    return rows.map((row) => ({
      BatchRunId: row.BatchRunId,
      MaxCreatedAt: String(row.MaxCreatedAt),
      NormalizedSetId: row.NormalizedSetId,
    }));
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

  async findRunDataForAllSuites({
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
    const client = await this.getClient(projectId);
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.lastUpdatedAtRead({
        projectId,
        scenarioSetId,
        startDate: startDate ?? nowInstant().subtract({ hours: 30 * 24 }).epochMilliseconds,
        endDate,
      }),
      table: simulationRuns.$table.name,
    });

    return Number(rows[0]?.LastUpdatedAt ?? 0);
  }

  async findExternalSetSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationExternalSetSummary[]> {
    return this.getSetSummaries({ ...params, filter: "external" });
  }

  async findInternalSuiteSummaries(params: {
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
    filter: SetSummaryFilter;
  }): Promise<SimulationExternalSetSummary[]> {
    const client = await this.getClient(projectId);
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.setSummariesRead({
        projectId,
        startDate,
        endDate,
        filter,
      }),
      table: simulationRuns.$table.name,
    });

    return rows.map((row) => ({
      scenarioSetId: row.NormalizedSetId,
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
  async findLastResultSummaries({
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
    const client = await this.getClient(projectId);
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.lastResultsRead({
        projectId,
        scenarioIds,
        startDate,
        endDate,
      }),
      table: simulationRuns.$table.name,
    });

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
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.setRunIdsRead({ projectId, scenarioSetId }),
      table: simulationRuns.$table.name,
      ...ID_BOUND_READ,
    });
    const runIds = rows.map((r) => r.ScenarioRunId);
    return { runIds, reachedCap: runIds.length === RUN_ID_CAP };
  }

  async findDistinctExternalSetIds({ projectIds }: { projectIds: string[] }): Promise<Set<string>> {
    if (projectIds.length === 0) return new Set();
    const { rows } = await this.#setReads.read({
      statement: SimulationClickHouseRepository.externalSetIdsRead({ projectIds }),
      table: simulationRuns.$table.name,
    });
    return new Set(rows.map((row) => row.NormalizedSetId));
  }

  // ---- Export sweep ----

  async countRunsForExport({
    projectId,
    scenarioSetId,
    scenarioId,
    startDate,
    endDate,
  }: ExportFilterInput): Promise<number> {
    const client = await this.getClient(projectId);
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.exportRunCountRead({
        projectId,
        scenarioSetId,
        scenarioId,
        startDate,
        endDate,
      }),
      table: simulationRuns.$table.name,
      ...ID_BOUND_READ,
    });
    return Number(rows[0]?.Total ?? 0);
  }

  /** One project at a time, so each read routes to the tenant's server, and added up. */
  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<number> {
    const totals = await Promise.all(
      [...new Set(projectIds)].map(async (projectId) => {
        const client = await this.getClient(projectId);
        const { rows } = await client.read({
          statement: SimulationClickHouseRepository.usageCountRead({ projectId, since }),
          table: simulationRuns.$table.name,
        });
        return Number(rows[0]?.Total ?? 0);
      }),
    );
    return totals.reduce((sum, total) => sum + total, 0);
  }

  /** One read over the organization's projects, which the caller holds. */
  async countOrganizationRuns({ projectIds }: { projectIds: readonly string[] }): Promise<number> {
    const tenantIds = [...new Set(projectIds)];
    if (tenantIds.length === 0) return 0;
    const { rows } = await this.#setReads.read({
      statement: SimulationClickHouseRepository.organizationRunCountRead({ projectIds: tenantIds }),
      table: simulationRuns.$table.name,
    });
    return Number(rows[0]?.Total ?? 0);
  }

  /**
   * Forward-only CSV export via keyset pagination (not OFFSET) on (StartedAt, ScenarioRunId),
   * reading whole runs, not the trimmed list fields; findRunDataForAllSuites is capped.
   */
  async listRunsForExport({
    projectId,
    scenarioSetId,
    scenarioId,
    startDate,
    endDate,
    limit,
    cursor,
  }: ExportFilterInput & { limit: number; cursor?: string }): Promise<{
    runs: SimulationExportRun[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const pageLimit = Math.min(Math.max(1, limit), 500);
    const client = await this.getClient(projectId);
    const holds = await client.holds({ table: simulationRuns.$table.name });
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.exportRunPageRead({
        projectId,
        scenarioSetId,
        scenarioId,
        startDate,
        endDate,
        limit: pageLimit,
        after: cursor ? this.decodeExportCursor(cursor) : null,
        holds,
      }),
      table: simulationRuns.$table.name,
      ...ID_BOUND_READ,
    });

    const hasMore = rows.length > pageLimit;
    const pageRows = hasMore ? rows.slice(0, pageLimit) : rows;
    const lastRow = pageRows.at(-1);
    const nextCursor =
      hasMore && lastRow
        ? this.encodeExportCursor(String(lastRow.ExportSortKey), lastRow.ScenarioRunId)
        : undefined;

    return {
      runs: pageRows.map((row) => ({
        ...mapClickHouseRowToScenarioRunData(runRowOf(row)),
        scenarioSetId: row.ScenarioSetId === "" ? DEFAULT_SET_ID : row.ScenarioSetId,
        traceIds: [...row.TraceIds],
      })),
      nextCursor,
      hasMore,
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

    const client = await this.getClient(projectId);
    const holds = await client.holds({ table: simulationRuns.$table.name });
    const input = { projectId, batchRunIds, scenarioSetId, holds };
    if (shouldIncludeMessages) {
      const { rows } = await client.read({
        statement: SimulationClickHouseRepository.batchesRunsRead(input),
        table: simulationRuns.$table.name,
        ...ID_BOUND_READ,
      });
      return rows.map((row) => mapClickHouseRowToScenarioRunData(runRowOf(row)));
    }
    const { rows } = await client.read({
      statement: SimulationClickHouseRepository.batchesListRunsRead(input),
      table: simulationRuns.$table.name,
      ...ID_BOUND_READ,
    });
    return rows.map((row) => mapClickHouseRowToScenarioRunData(listRunRowOf(row)));
  }

  /**
   * One batch's counts, note and actor, latest versions only. The note and the actor are read
   * here and not in {@link batchAggregateFields}: this read is bounded to one batch.
   */
  static batchSummaryRead(input: {
    projectId: string;
    batchRunId: string;
  }): ReaderReadStatement<BatchSummaryRow> {
    return batchSummaryReadOf(input);
  }

  /** When any version of a batch's runs last changed, every version counted. */
  static batchLastUpdatedRead({
    projectId,
    batchRunId,
  }: {
    projectId: string;
    batchRunId: string;
  }): ReaderReadStatement<{ LastUpdatedAt: number }> {
    const t = simulationRuns;
    return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
      .from(t)
      .select({ LastUpdatedAt: fn.toUnixTimestamp64Milli(fn.max(t.UpdatedAt)) })
      .where(({ and, idBound, isNull }) =>
        and(idBound(t.BatchRunId, batchRunId), isNull(t.ArchivedAt)),
      )
      .build();
  }

  /** How many batches a set ran in the date range, latest versions only. */
  static batchRunCountRead({
    projectId,
    scenarioSetId,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId: string;
    startDate?: number;
    endDate?: number;
  }): ReaderReadStatement<{ BatchRunCount: number }> {
    const t = simulationRuns;
    const setIds = SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId);
    // One conjunct per `where`: the election repeats the StartedAt ones for partition pruning.
    let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
      .from(t)
      .select({ BatchRunCount: fn.countDistinct(t.BatchRunId) })
      .where(({ idBound }) => idBound(t.ScenarioSetId, setIds));
    if (startDate !== undefined) read = read.where(({ gte }) => gte(t.StartedAt, startDate));
    if (endDate !== undefined) read = read.where(({ lte }) => lte(t.StartedAt, endDate));
    return read
      .where(({ isNull }) => isNull(t.ArchivedAt))
      .latestVersion()
      .build();
  }

  /**
   * One page of a set's batches, newest run first, keyset paginated on (LastRunAt, BatchRunId).
   * The range bounds StartedAt for pruning and the batch's newest CreatedAt exactly.
   */
  static batchHistoryPageRead({
    projectId,
    scenarioSetId,
    limit,
    after,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId: string;
    limit: number;
    after: { ts: string; batchRunId: string } | null;
    startDate?: number;
    endDate?: number;
  }): ReaderReadStatement<BuiltBatchAggregateRow> {
    return batchHistoryPageReadOf({
      projectId,
      setIds: SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId),
      limit,
      after,
      startDate,
      endDate,
    });
  }

  /**
   * The slim preview runs of a page's batches, latest versions, oldest first; bounded by the
   * batch id index (one id lookup per statement) and, when step 1 found one, the page's window.
   */
  static batchPreviewItemsRead(input: {
    projectId: string;
    scenarioSetId: string;
    batchRunIds: string[];
    window: Pick<WindowFragment, "fromMs" | "toMs"> | null;
  }): ReaderReadStatement<PreviewItemRow> {
    return batchPreviewItemsReadOf({
      ...input,
      setIds: SimulationClickHouseRepository.expandSetIdFilter(input.scenarioSetId),
    });
  }

  /**
   * A batch's whole runs, latest versions, oldest first, bounded by the batch id index; an
   * absent set id reads the batch alone (the CLI's --wait), `""` selects the default set.
   */
  static batchRunsRead({
    scenarioSetId,
    ...input
  }: {
    projectId: string;
    scenarioSetId: string | undefined;
    batchRunId: string;
    holds: (name: string) => boolean;
  }): ReaderReadStatement<BuiltRunRow> {
    return batchRunsReadOf({
      ...input,
      setIds:
        scenarioSetId === undefined
          ? undefined
          : SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId),
    });
  }

  /**
   * Newest UpdatedAt across every live run version, agent test runs excluded; a version column's
   * max over all versions is the latest version's, so no election.
   */
  static maxUpdatedAtRead({
    projectId,
  }: {
    projectId: string;
  }): ReaderReadStatement<{ LastUpdatedAt: number }> {
    const t = simulationRuns;
    return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
      .from(t)
      .select({ LastUpdatedAt: fn.toUnixTimestamp64Milli(fn.max(t.UpdatedAt)) })
      .where(({ and, isNull, ne, not }) =>
        and(
          isNull(t.ArchivedAt),
          not(fn.endsWith(t.ScenarioSetId, AGENT_TEST_SET_SUFFIX)),
          ne(t.ScenarioSetId, VOICE_CALL_SCENARIO_SET_ID),
        ),
      )
      .build();
  }

  /** Newest UpdatedAt of any version in the StartedAt window, optionally in one set. */
  static lastUpdatedAtRead({
    projectId,
    scenarioSetId,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId: string | undefined;
    startDate: number;
    endDate: number | undefined;
  }): ReaderReadStatement<{ LastUpdatedAt: number }> {
    const t = simulationRuns;
    let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
      .from(t)
      .select({ LastUpdatedAt: fn.toUnixTimestamp64Milli(fn.max(t.UpdatedAt)) })
      .where(({ gte }) => gte(t.StartedAt, startDate));
    if (endDate !== undefined) read = read.where(({ lte }) => lte(t.StartedAt, endDate));
    if (scenarioSetId) {
      const setIds = SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId);
      read = read.where(({ oneOf }) => oneOf(t.ScenarioSetId, setIds));
    }
    return read.build();
  }

  /**
   * The ids of a set's live runs, capped at {@link RUN_ID_CAP}. Elected before ArchivedAt is
   * tested: an older unarchived version would otherwise re-dispatch an archived run's deletion.
   */
  static setRunIdsRead({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): ReaderReadStatement<{ ScenarioRunId: string }> {
    const t = simulationRuns;
    const setIds = SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId);
    return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
      .from(t)
      .select({ ScenarioRunId: t.ScenarioRunId })
      .distinct()
      .where(({ idBound }) => idBound(t.ScenarioSetId, setIds))
      .where(({ isNull }) => isNull(t.ArchivedAt))
      .latestVersion()
      .limit(RUN_ID_CAP)
      .build();
  }

  /** One run's latest version: `UpdatedAt` equal to a scalar `max(UpdatedAt)`, both id-bound. */
  static scenarioRunRead(input: {
    projectId: string;
    scenarioRunId: string;
    holds: (name: string) => boolean;
  }): ReaderReadStatement<BuiltRunRow> {
    return scenarioRunReadOf(input);
  }

  /** A set's whole runs, latest versions, by batch then oldest, capped at {@link RUN_ID_CAP}. */
  static setRunsRead({
    scenarioSetId,
    ...input
  }: {
    projectId: string;
    scenarioSetId: string;
    holds: (name: string) => boolean;
  }): ReaderReadStatement<BuiltRunRow> {
    return setRunsReadOf({
      ...input,
      setIds: SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId),
    });
  }

  /** A page of batches' whole runs, latest versions, oldest first. */
  static batchesRunsRead(input: BatchesRunsInput): ReaderReadStatement<BuiltRunRow> {
    return batchesRunsReadOf(SimulationClickHouseRepository.batchesInputOf(input));
  }

  /** A page of batches' runs trimmed for a list: six messages, no prose or traces. */
  static batchesListRunsRead(input: BatchesRunsInput): ReaderReadStatement<BuiltListRunRow> {
    return batchesListRunsReadOf(SimulationClickHouseRepository.batchesInputOf(input));
  }

  /** Each set's live run count and newest change, agent test runs left out. */
  static setsListRead(input: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): ReaderReadStatement<SetsListRow> {
    return setsListReadOf(input);
  }

  /** One page of a set's batch ids, newest run first, bounded by the set id index. */
  static setBatchPageRead({
    scenarioSetId,
    ...input
  }: BatchPageInput & { scenarioSetId: string }): ReaderReadStatement<BatchPageRow> {
    return batchPageReadOf({
      ...input,
      setIds: SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId),
    });
  }

  /** One page of batch ids across every set, newest run first, agent test runs left out. */
  static suitesBatchPageRead(input: BatchPageInput): ReaderReadStatement<BatchPageRow> {
    return batchPageReadOf({ ...input, setIds: undefined });
  }

  /**
   * Each set's newest batch's settled, passed and failed counts, and when it last ran. Kept in
   * step with computeGroupSummary() in the browser's run-history-transforms.ts.
   */
  static setSummariesRead(input: {
    projectId: string;
    startDate?: number;
    endDate?: number;
    filter: SetSummaryFilter;
  }): ReaderReadStatement<SetSummaryRow> {
    return setSummariesReadOf(input);
  }

  /** Each scenario's newest live run in the range: verdict, counts, batch, set, cost. */
  static lastResultsRead(input: {
    projectId: string;
    scenarioIds: string[] | undefined;
    startDate?: number;
    endDate?: number;
  }): ReaderReadStatement<LastResultRow> {
    return lastResultsReadOf(input);
  }

  /** The external set ids holding a live run, over one organization's projects. */
  static externalSetIdsRead({
    projectIds,
  }: {
    projectIds: readonly string[];
  }): ReaderReadStatement<ExternalSetIdRow> {
    return externalSetIdsReadOf({ projectIds });
  }

  /** How many live runs one organization's projects hold, in one read. */
  static organizationRunCountRead(input: {
    projectIds: readonly string[];
  }): ReaderReadStatement<RunCountRow> {
    return organizationRunCountReadOf(input);
  }

  /** How many live runs one project started since `since`, or ever. */
  static usageCountRead(input: {
    projectId: string;
    since?: number;
  }): ReaderReadStatement<RunCountRow> {
    return usageCountReadOf(input);
  }

  /** How many live runs the export's filters hold. */
  static exportRunCountRead({
    scenarioSetId,
    ...input
  }: ExportFilterInput): ReaderReadStatement<RunCountRow> {
    return exportRunsOf({
      ...input,
      setIds: SimulationClickHouseRepository.exportSetIds(scenarioSetId),
    })
      .select({ Total: fn.count() })
      .build();
  }

  /** One export page of whole runs after `after`, one row past the page when more follow. */
  static exportRunPageRead({
    scenarioSetId,
    ...input
  }: ExportPageInput): ReaderReadStatement<ExportRunRow> {
    return exportRunPageReadOf({
      ...input,
      setIds: SimulationClickHouseRepository.exportSetIds(scenarioSetId),
    });
  }

  private static exportSetIds(scenarioSetId: string | undefined): string[] | undefined {
    return scenarioSetId
      ? SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId)
      : undefined;
  }

  private static batchesInputOf({ scenarioSetId, ...input }: BatchesRunsInput) {
    return {
      ...input,
      setIds: scenarioSetId
        ? SimulationClickHouseRepository.expandSetIdFilter(scenarioSetId)
        : undefined,
    };
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
    row: BuiltBatchAggregateRow,
  ): Omit<SimulationBatchSummary, "stalledCount" | "note" | "startedBy"> {
    const firstCompletedAt = Number(row.FirstCompletedAt);
    const allCompletedAt = Number(row.AllCompletedAt);

    return {
      batchRunId: String(row.BatchRunId),
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
}

/** A row of {@link SimulationClickHouseRepository.batchSummaryRead}. */
type BatchSummaryRow =
  ReturnType<typeof batchSummaryReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

function batchSummaryReadOf({ projectId, batchRunId }: { projectId: string; batchRunId: string }) {
  const t = simulationRuns;
  const note = metadataString("note");
  const actorId = metadataString("langwatch", "actorId");
  return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select((ops) => ({
      ...batchAggregateFields(ops),
      Note: fn.anyIf(note, ops.ne(note, "")),
      ActorId: fn.anyIf(actorId, ops.ne(actorId, "")),
      ActorLabel: fn.anyIf(metadataString("langwatch", "actorLabel"), ops.ne(actorId, "")),
    }))
    .where(({ idBound }) => idBound(t.BatchRunId, batchRunId))
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion()
    .groupBy(t.BatchRunId)
    .build();
}

function batchHistoryPageReadOf({
  projectId,
  setIds,
  limit,
  after,
  startDate,
  endDate,
}: {
  projectId: string;
  setIds: string[];
  limit: number;
  after: { ts: string; batchRunId: string } | null;
  startDate?: number;
  endDate?: number;
}) {
  const t = simulationRuns;
  const lastRunAt = fn.toUnixTimestamp64Milli(fn.max(t.CreatedAt));
  // One conjunct per `where`: the election repeats the StartedAt ones for partition pruning.
  let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select((ops) => batchAggregateFields(ops))
    .where(({ idBound }) => idBound(t.ScenarioSetId, setIds));
  if (startDate !== undefined) read = read.where(({ gte }) => gte(t.StartedAt, startDate));
  if (endDate !== undefined) read = read.where(({ lte }) => lte(t.StartedAt, endDate));
  let page = read
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion()
    .groupBy(t.BatchRunId);
  if (after !== null) {
    const ts = Number(after.ts);
    page = page.having(({ and, eq, gt, lt, or }) =>
      or(lt(lastRunAt, ts), and(eq(lastRunAt, ts), gt(t.BatchRunId, after.batchRunId))),
    );
  }
  if (startDate !== undefined) page = page.having(({ gte }) => gte(lastRunAt, startDate));
  if (endDate !== undefined) page = page.having(({ lte }) => lte(lastRunAt, endDate));
  return page.orderBy(lastRunAt, "DESC").orderBy(t.BatchRunId, "ASC").limit(limit).build();
}

/** A row of {@link SimulationClickHouseRepository.batchPreviewItemsRead}. */
type PreviewItemRow =
  ReturnType<typeof batchPreviewItemsReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

function batchPreviewItemsReadOf({
  projectId,
  setIds,
  batchRunIds,
  window,
}: {
  projectId: string;
  setIds: string[];
  batchRunIds: string[];
  window: Pick<WindowFragment, "fromMs" | "toMs"> | null;
}) {
  const t = simulationRuns;
  // One conjunct per `where`: the election repeats the StartedAt ones for partition pruning.
  let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select({
      ScenarioRunId: t.ScenarioRunId,
      BatchRunId: t.BatchRunId,
      Name: t.Name,
      Description: t.Description,
      Status: t.Status,
      DurationMs: t.DurationMs,
      FinishedAtMs: fn.toUnixTimestamp64Milli(t.FinishedAt),
      Note: metadataString("note"),
      ActorId: metadataString("langwatch", "actorId"),
      ActorLabel: metadataString("langwatch", "actorLabel"),
      MessagePreviewRoles: fn.arraySlice(t["Messages.Role"], 1, 4),
      MessagePreviewContents: fn.arraySlice(t["Messages.Content"], 1, 4),
    })
    .where(({ idBound }) => idBound(t.BatchRunId, batchRunIds))
    .where(({ oneOf }) => oneOf(t.ScenarioSetId, setIds));
  if (window !== null) {
    read = read
      .where(({ gte }) => gte(t.StartedAt, window.fromMs))
      .where(({ lte }) => lte(t.StartedAt, window.toMs));
  }
  return read
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion({ repeat: [t.ScenarioSetId] })
    .orderBy(t.CreatedAt, "ASC")
    .build();
}

/** A `Criteria.*` column, or its typed empty array on a target before goose 00101. */
function heldCriteria(holds: (name: string) => boolean) {
  const t = simulationRuns;
  const strings = fn.emptyArrayAs(column.array(column.string()));
  return {
    criteriaCriterion: fn.heldOr(t["Criteria.Criterion"], { holds, otherwise: strings }),
    criteriaRequirement: fn.heldOr(t["Criteria.Requirement"], { holds, otherwise: strings }),
    criteriaStatus: fn.heldOr(t["Criteria.Status"], {
      holds,
      otherwise: fn.emptyArrayAs(column.array(column.lowCardinality(column.string()))),
    }),
    criteriaReasoning: fn.heldOr(t["Criteria.Reasoning"], { holds, otherwise: strings }),
  };
}

/** The columns a list read and a whole-run read share; dotted ones under plain keys. */
function sharedRunFieldsOf(holds: (name: string) => boolean) {
  const t = simulationRuns;
  const millis = fn.toUnixTimestamp64Milli;
  return {
    ScenarioRunId: t.ScenarioRunId,
    ScenarioId: t.ScenarioId,
    BatchRunId: t.BatchRunId,
    ScenarioSetId: t.ScenarioSetId,
    Status: t.Status,
    Name: t.Name,
    Description: t.Description,
    Metadata: t.Metadata,
    Verdict: t.Verdict,
    MetCriteria: t.MetCriteria,
    UnmetCriteria: t.UnmetCriteria,
    InconclusiveCriteria: t.InconclusiveCriteria,
    evaluationEvaluatorIds: t["Evaluations.EvaluatorId"],
    evaluationNames: t["Evaluations.Name"],
    evaluationStatuses: t["Evaluations.Status"],
    evaluationRequired: t["Evaluations.Required"],
    evaluationPassed: t["Evaluations.Passed"],
    evaluationScores: t["Evaluations.Score"],
    evaluationLabels: t["Evaluations.Label"],
    evaluationCostAmounts: t["Evaluations.CostAmount"],
    evaluationCostCurrencies: t["Evaluations.CostCurrency"],
    ...heldCriteria(holds),
    DurationMs: t.DurationMs,
    TotalCost: t.TotalCost,
    RoleCosts: t.RoleCosts,
    RoleLatencies: t.RoleLatencies,
    startedAtMs: millis(t.StartedAt),
    createdAtMs: millis(t.CreatedAt),
    updatedAtMs: millis(t.UpdatedAt),
    finishedAtMs: millis(t.FinishedAt),
    archivedAtMs: millis(t.ArchivedAt),
  };
}

/** A whole run's columns; timestamps in Unix milliseconds. */
function runFieldsOf(holds: (name: string) => boolean) {
  const t = simulationRuns;
  return {
    ...sharedRunFieldsOf(holds),
    messageIds: t["Messages.Id"],
    messageRoles: t["Messages.Role"],
    messageContents: t["Messages.Content"],
    messageTraceIds: t["Messages.TraceId"],
    messageRests: t["Messages.Rest"],
    TraceIds: t.TraceIds,
    Reasoning: t.Reasoning,
    Error: t.Error,
    evaluationDetails: t["Evaluations.Details"],
    evaluationInputsJson: t["Evaluations.InputsJson"],
  };
}

/**
 * A list row's columns: the first six messages and the count of all of them; the prose, traces,
 * evaluation details and inputs belong to the run drawer and are not read.
 */
function listRunFieldsOf(holds: (name: string) => boolean) {
  const t = simulationRuns;
  return {
    ...sharedRunFieldsOf(holds),
    TotalMessageCount: fn.length(t["Messages.Role"]),
    messageIds: fn.arraySlice(t["Messages.Id"], 1, 6),
    messageRoles: fn.arraySlice(t["Messages.Role"], 1, 6),
    messageContents: fn.arraySlice(t["Messages.Content"], 1, 6),
  };
}

/** A row of {@link runFieldsOf}, as a built read answers it. */
type BuiltRunRow =
  ReturnType<typeof batchRunsReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

const millisText = (value: string | number | null) => (value === null ? null : String(value));

const perRole = (values: Readonly<Record<string, readonly number[]>>) =>
  Object.fromEntries(Object.entries(values).map(([role, entries]) => [role, [...entries]]));

/** A built run row in the shape the run mapper reads. */
function runRowOf(row: BuiltRunRow): ClickHouseSimulationRunRow {
  return {
    ScenarioRunId: row.ScenarioRunId,
    ScenarioId: row.ScenarioId,
    BatchRunId: row.BatchRunId,
    ScenarioSetId: row.ScenarioSetId,
    Status: row.Status,
    Name: row.Name,
    Description: row.Description,
    Metadata: row.Metadata,
    "Messages.Id": [...row.messageIds],
    "Messages.Role": [...row.messageRoles],
    "Messages.Content": [...row.messageContents],
    "Messages.TraceId": [...row.messageTraceIds],
    "Messages.Rest": [...row.messageRests],
    TraceIds: [...row.TraceIds],
    Verdict: row.Verdict,
    Reasoning: row.Reasoning,
    MetCriteria: [...row.MetCriteria],
    UnmetCriteria: [...row.UnmetCriteria],
    InconclusiveCriteria: [...row.InconclusiveCriteria],
    Error: row.Error,
    "Evaluations.EvaluatorId": [...row.evaluationEvaluatorIds],
    "Evaluations.Name": [...row.evaluationNames],
    "Evaluations.Status": [...row.evaluationStatuses],
    "Evaluations.Required": [...row.evaluationRequired],
    "Evaluations.Passed": [...row.evaluationPassed],
    "Evaluations.Score": [...row.evaluationScores],
    "Evaluations.Label": [...row.evaluationLabels],
    "Evaluations.Details": [...row.evaluationDetails],
    "Evaluations.CostAmount": [...row.evaluationCostAmounts],
    "Evaluations.CostCurrency": [...row.evaluationCostCurrencies],
    "Evaluations.InputsJson": [...row.evaluationInputsJson],
    "Criteria.Criterion": [...row.criteriaCriterion],
    "Criteria.Requirement": [...row.criteriaRequirement],
    "Criteria.Status": [...row.criteriaStatus],
    "Criteria.Reasoning": [...row.criteriaReasoning],
    DurationMs: millisText(row.DurationMs),
    TotalCost: row.TotalCost,
    RoleCosts: perRole(row.RoleCosts),
    RoleLatencies: perRole(row.RoleLatencies),
    StartedAt: millisText(row.startedAtMs),
    CreatedAt: String(row.createdAtMs),
    UpdatedAt: String(row.updatedAtMs),
    FinishedAt: millisText(row.finishedAtMs),
    ArchivedAt: millisText(row.archivedAtMs),
  };
}

/** A row of {@link listRunFieldsOf}, as a built read answers it. */
type BuiltListRunRow =
  ReturnType<typeof batchesListRunsReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

/** A built list row in the run mapper's shape; the columns a list leaves out read empty. */
function listRunRowOf({ TotalMessageCount, ...row }: BuiltListRunRow): ClickHouseSimulationRunRow {
  return {
    ...runRowOf({
      ...row,
      messageTraceIds: [],
      messageRests: [],
      TraceIds: [],
      Reasoning: null,
      Error: null,
      evaluationDetails: [],
      evaluationInputsJson: [],
    }),
    TotalMessageCount: String(TotalMessageCount),
  };
}

type BatchesRunsInput = {
  projectId: string;
  batchRunIds: string[];
  /** Narrows to one set when non-empty; `"default"` selects the default set under both ids. */
  scenarioSetId: string | undefined;
  holds: (name: string) => boolean;
};

type BatchesReadInput = Omit<BatchesRunsInput, "scenarioSetId"> & {
  setIds: string[] | undefined;
};

function scenarioRunReadOf({
  projectId,
  scenarioRunId,
  holds,
}: {
  projectId: string;
  scenarioRunId: string;
  holds: (name: string) => boolean;
}) {
  const t = simulationRuns;
  return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select(runFieldsOf(holds))
    .where(({ and, eq, idBound, isNull, scalar }) => {
      const latest = scalar((sub) =>
        sub
          .from(t)
          .select({ latestUpdatedAt: fn.max(t.UpdatedAt) })
          .where((inner) => inner.idBound(t.ScenarioRunId, scenarioRunId)),
      );
      return and(
        idBound(t.ScenarioRunId, scenarioRunId),
        isNull(t.ArchivedAt),
        eq(t.UpdatedAt, latest),
      );
    })
    .limit(1)
    .build();
}

function setRunsReadOf({
  projectId,
  setIds,
  holds,
}: {
  projectId: string;
  setIds: string[];
  holds: (name: string) => boolean;
}) {
  const t = simulationRuns;
  return clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select(runFieldsOf(holds))
    .where(({ idBound }) => idBound(t.ScenarioSetId, setIds))
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion()
    .orderBy(t.BatchRunId, "ASC")
    .orderBy(t.CreatedAt, "ASC")
    .limit(RUN_ID_CAP)
    .build();
}

/** The cap on one page of batches' runs, as before the port. */
const BATCHES_RUNS_LIMIT = 5000;

function batchesRunsReadOf({ projectId, batchRunIds, setIds, holds }: BatchesReadInput) {
  const t = simulationRuns;
  let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select(runFieldsOf(holds))
    .where(({ idBound }) => idBound(t.BatchRunId, batchRunIds));
  if (setIds !== undefined) read = read.where(({ oneOf }) => oneOf(t.ScenarioSetId, setIds));
  return read
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion({ repeat: [t.ScenarioSetId] })
    .orderBy(t.CreatedAt, "ASC")
    .limit(BATCHES_RUNS_LIMIT)
    .build();
}

function batchesListRunsReadOf({ projectId, batchRunIds, setIds, holds }: BatchesReadInput) {
  const t = simulationRuns;
  let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select(listRunFieldsOf(holds))
    .where(({ idBound }) => idBound(t.BatchRunId, batchRunIds));
  if (setIds !== undefined) read = read.where(({ oneOf }) => oneOf(t.ScenarioSetId, setIds));
  return read
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion({ repeat: [t.ScenarioSetId] })
    .orderBy(t.CreatedAt, "ASC")
    .limit(BATCHES_RUNS_LIMIT)
    .build();
}

function batchRunsReadOf({
  projectId,
  batchRunId,
  setIds,
  holds,
}: {
  projectId: string;
  batchRunId: string;
  setIds: string[] | undefined;
  holds: (name: string) => boolean;
}) {
  const t = simulationRuns;
  let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select(runFieldsOf(holds))
    .where(({ idBound }) => idBound(t.BatchRunId, batchRunId));
  if (setIds !== undefined) read = read.where(({ oneOf }) => oneOf(t.ScenarioSetId, setIds));
  return read
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion({ repeat: [t.ScenarioSetId] })
    .orderBy(t.CreatedAt, "ASC")
    .build();
}

/** A row of {@link SimulationClickHouseRepository.setsListRead}. */
type SetsListRow =
  ReturnType<typeof setsListReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

function setsListReadOf({
  projectId,
  startDate,
  endDate,
}: {
  projectId: string;
  startDate?: number;
  endDate?: number;
}) {
  const t = simulationRuns;
  // One conjunct per `where`: the election repeats the StartedAt ones for partition pruning.
  let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select({
      NormalizedSetId: normalizedSetId,
      ScenarioCount: fn.count(),
      LastRunAt: fn.toUnixTimestamp64Milli(fn.max(t.UpdatedAt)),
    })
    .where((ops) => notAgentTestRun(ops));
  if (startDate !== undefined) read = read.where(({ gte }) => gte(t.StartedAt, startDate));
  if (endDate !== undefined) read = read.where(({ lte }) => lte(t.StartedAt, endDate));
  return read
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion()
    .groupBy(normalizedSetId)
    .orderBy("LastRunAt", "DESC")
    .build();
}

type BatchPageInput = {
  projectId: string;
  limit: number;
  after: CursorPayload | null;
  startDate?: number;
  endDate?: number;
};

/** A row of {@link SimulationClickHouseRepository.setBatchPageRead}. */
type BatchPageRow =
  ReturnType<typeof batchPageReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

/**
 * A page of batch ids keyset paginated on (newest CreatedAt, BatchRunId): a set's by the set id
 * index, or every set's but agent test runs. The range bounds StartedAt and the newest run.
 */
function batchPageReadOf({
  projectId,
  setIds,
  limit,
  after,
  startDate,
  endDate,
}: BatchPageInput & { setIds: string[] | undefined }) {
  const t = simulationRuns;
  const maxCreatedAt = fn.toUnixTimestamp64Milli(fn.max(t.CreatedAt));
  let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select({
      BatchRunId: t.BatchRunId,
      MaxCreatedAt: maxCreatedAt,
      NormalizedSetId: fn.any(normalizedSetId),
    })
    .where((ops) =>
      setIds === undefined ? notAgentTestRun(ops) : ops.idBound(t.ScenarioSetId, setIds),
    );
  if (startDate !== undefined) read = read.where(({ gte }) => gte(t.StartedAt, startDate));
  if (endDate !== undefined) read = read.where(({ lte }) => lte(t.StartedAt, endDate));
  let page = read
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion()
    .groupBy(t.BatchRunId);
  if (after !== null) {
    const ts = Number(after.ts);
    page = page.having(({ and, eq, gt, lt, or }) =>
      or(lt(maxCreatedAt, ts), and(eq(maxCreatedAt, ts), gt(t.BatchRunId, after.batchRunId))),
    );
  }
  if (startDate !== undefined) page = page.having(({ gte }) => gte(maxCreatedAt, startDate));
  if (endDate !== undefined) page = page.having(({ lte }) => lte(maxCreatedAt, endDate));
  return page.orderBy(maxCreatedAt, "DESC").orderBy(t.BatchRunId, "ASC").limit(limit).build();
}

/** A row of {@link SimulationClickHouseRepository.setSummariesRead}. */
type SetSummaryRow =
  ReturnType<typeof setSummariesReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

/**
 * Per batch, then per set: a batch's settled count is every run not running, an unscored run out
 * of it and of the failures; the set reads its newest batch by first start (the browser's
 * minTimestamp). The set filter repeats in the election.
 */
function setSummariesReadOf({
  projectId,
  startDate,
  endDate,
  filter,
}: {
  projectId: string;
  startDate?: number;
  endDate?: number;
  filter: SetSummaryFilter;
}) {
  const t = simulationRuns;
  const scope = tenantScope.single({ tenantId: projectId });
  const setId = filter === "external" ? normalizedSetId : t.ScenarioSetId;
  const lastRunAt = fn.toUnixTimestamp64Milli(fn.max(t.CreatedAt));
  let read = clickhouseRead({ scope })
    .from(t)
    .select((ops) => {
      const { and, eq, not, oneOf } = ops;
      const scored = not(runNotScored(ops));
      return {
        NormalizedSetId: setId,
        BatchRunId: t.BatchRunId,
        BatchSettled: fn.countIf(and(not(oneOf(t.Status, RUNNING_STATUS_LIST)), scored)),
        BatchPassed: fn.countIf(eq(t.Status, "SUCCESS")),
        BatchFailed: fn.countIf(and(oneOf(t.Status, SUMMARY_FAILED_STATUS_LIST), scored)),
        BatchStartedAtMs: fn.toUnixTimestamp64Milli(fn.min(fn.ifNull(t.StartedAt, t.CreatedAt))),
      };
    })
    .where((ops) => setSummaryFilter(filter, ops));
  if (startDate !== undefined) read = read.where(({ gte }) => gte(t.StartedAt, startDate));
  if (endDate !== undefined) read = read.where(({ lte }) => lte(t.StartedAt, endDate));
  let perBatch = read
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion({ repeat: [t.ScenarioSetId] })
    .groupBy(setId, t.BatchRunId);
  if (startDate !== undefined) perBatch = perBatch.having(({ gte }) => gte(lastRunAt, startDate));
  if (endDate !== undefined) perBatch = perBatch.having(({ lte }) => lte(lastRunAt, endDate));
  const batches = perBatch.as("batches");
  return clickhouseRead({ scope })
    .from(batches)
    .select({
      NormalizedSetId: batches.NormalizedSetId,
      TotalCount: fn.argMax(batches.BatchSettled, batches.BatchStartedAtMs),
      PassCount: fn.argMax(batches.BatchPassed, batches.BatchStartedAtMs),
      FailCount: fn.argMax(batches.BatchFailed, batches.BatchStartedAtMs),
      LastRunAt: fn.max(batches.BatchStartedAtMs),
    })
    .groupBy(batches.NormalizedSetId)
    .orderBy("LastRunAt", "DESC")
    .build();
}

/** A row of {@link SimulationClickHouseRepository.lastResultsRead}. */
type LastResultRow =
  ReturnType<typeof lastResultsReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

/**
 * Duration and cost ride the same argMax as the verdict, stringified with '' for NULL first: an
 * aggregate over the raw Nullable column would skip NULL rows and serve an older run's value for
 * a latest run that has none yet. The set exclusion, and named scenarios, repeat in the election.
 */
function lastResultsReadOf({
  projectId,
  scenarioIds,
  startDate,
  endDate,
}: {
  projectId: string;
  scenarioIds: string[] | undefined;
  startDate?: number;
  endDate?: number;
}) {
  const t = simulationRuns;
  const latest = t.UpdatedAt;
  // A run keeps its ScenarioId across versions, so naming scenarios narrows the election too.
  const named = scenarioIds === undefined ? [] : [t.ScenarioId];
  let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select({
      ScenarioId: t.ScenarioId,
      LastStatus: fn.argMax(t.Status, latest),
      MetCriteriaCount: fn.argMax(fn.length(t.MetCriteria), latest),
      UnmetCriteriaCount: fn.argMax(fn.length(t.UnmetCriteria), latest),
      LastRunAt: fn.toUnixTimestamp64Milli(fn.max(fn.ifNull(t.StartedAt, t.CreatedAt))),
      LastBatchRunId: fn.argMax(t.BatchRunId, latest),
      LastScenarioSetId: fn.argMax(t.ScenarioSetId, latest),
      LastDurationMs: fn.argMax(fn.ifNull(fn.toString(t.DurationMs), ""), latest),
      LastTotalCost: fn.argMax(fn.ifNull(fn.toString(t.TotalCost), ""), latest),
    })
    .where(({ ne }) => ne(t.ScenarioId, ""));
  if (scenarioIds !== undefined) read = read.where(({ oneOf }) => oneOf(t.ScenarioId, scenarioIds));
  if (startDate !== undefined) read = read.where(({ gte }) => gte(t.StartedAt, startDate));
  if (endDate !== undefined) read = read.where(({ lte }) => lte(t.StartedAt, endDate));
  return read
    .where((ops) => notAgentTestRun(ops))
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion({ repeat: [t.ScenarioSetId, ...named] })
    .groupBy(t.ScenarioId)
    .build();
}

/** A row of {@link SimulationClickHouseRepository.externalSetIdsRead}. */
type ExternalSetIdRow =
  ReturnType<typeof externalSetIdsReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

/**
 * Each run folded to its latest version over light columns, its set kept when that version is
 * live. Folds `isNull(ArchivedAt)`, not ArchivedAt: argMax skips a NULL first argument and would
 * miss a freshly un-archived run's latest version.
 */
function externalSetIdsReadOf({ projectIds }: { projectIds: readonly string[] }) {
  const t = simulationRuns;
  const scope = tenantScope.set({ tenantIds: projectIds });
  const runs = clickhouseRead({ scope })
    .from(t)
    .select(({ isNull }) => ({
      NormalizedSetId: normalizedSetId,
      LatestIsActive: fn.argMax(isNull(t.ArchivedAt), t.UpdatedAt),
    }))
    .where((ops) =>
      ops.and(ops.not(fn.startsWith(t.ScenarioSetId, INTERNAL_SET_PREFIX)), notAgentTestRun(ops)),
    )
    .groupBy(t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId)
    .as("runs");
  return clickhouseRead({ scope })
    .from(runs)
    .select({ NormalizedSetId: runs.NormalizedSetId })
    .where(() => runs.LatestIsActive)
    .distinct()
    .build();
}

/** A row of a live-run count. */
type RunCountRow =
  ReturnType<typeof organizationRunCountReadOf> extends ReaderReadStatement<infer Row>
    ? Row
    : never;

function organizationRunCountReadOf({ projectIds }: { projectIds: readonly string[] }) {
  const t = simulationRuns;
  return clickhouseRead({ scope: tenantScope.set({ tenantIds: projectIds }) })
    .from(t)
    .select({ Total: fn.count() })
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion()
    .build();
}

/** The window repeats in the election, as StartedAt is the partition key. */
function usageCountReadOf({ projectId, since }: { projectId: string; since?: number }) {
  const t = simulationRuns;
  let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) })
    .from(t)
    .select({ Total: fn.count() });
  if (since !== undefined) read = read.where(({ gte }) => gte(t.StartedAt, since));
  return read
    .where(({ isNull }) => isNull(t.ArchivedAt))
    .latestVersion()
    .build();
}

type ExportFilterInput = {
  projectId: string;
  scenarioSetId?: string;
  scenarioId?: string;
  startDate?: number;
  endDate?: number;
};

type ExportPageInput = ExportFilterInput & {
  limit: number;
  after: { ts: string; scenarioRunId: string } | null;
  holds: (name: string) => boolean;
};

type ExportReadInput = Omit<ExportFilterInput, "scenarioSetId"> & { setIds: string[] | undefined };

/**
 * The export's live runs: the set and scenario repeat in the election; the StartedAt range
 * applies only after the latest version wins, since it changes between a run's versions.
 */
function exportRunsOf({ projectId, setIds, scenarioId, startDate, endDate }: ExportReadInput) {
  const t = simulationRuns;
  const outside = { inElection: false };
  let read = clickhouseRead({ scope: tenantScope.single({ tenantId: projectId }) }).from(t);
  if (setIds !== undefined) read = read.where(({ idBound }) => idBound(t.ScenarioSetId, setIds));
  if (scenarioId) read = read.where(({ eq }) => eq(t.ScenarioId, scenarioId));
  if (startDate !== undefined) read = read.where(({ gte }) => gte(t.StartedAt, startDate), outside);
  if (endDate !== undefined) read = read.where(({ lte }) => lte(t.StartedAt, endDate), outside);
  return read.where(({ isNull }) => isNull(t.ArchivedAt)).latestVersion({ repeat: [t.ScenarioId] });
}

/** A row of {@link SimulationClickHouseRepository.exportRunPageRead}. */
type ExportRunRow =
  ReturnType<typeof exportRunPageReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

/** Whole runs in sort-key order after the cursor; one row past the page tells more follow. */
function exportRunPageReadOf({
  holds,
  limit,
  after,
  ...filters
}: Omit<ExportPageInput, "scenarioSetId"> & { setIds: string[] | undefined }) {
  const t = simulationRuns;
  let read = exportRunsOf(filters).select({ ...runFieldsOf(holds), ExportSortKey: exportSortKey });
  if (after !== null) {
    const ts = Number(after.ts);
    read = read.where(
      ({ and, eq, gt, or }) =>
        or(
          gt(exportSortKey, ts),
          and(eq(exportSortKey, ts), gt(t.ScenarioRunId, after.scenarioRunId)),
        ),
      { inElection: false },
    );
  }
  return read
    .orderBy(exportSortKey, "ASC")
    .orderBy(t.ScenarioRunId, "ASC")
    .limit(limit + 1)
    .build();
}
