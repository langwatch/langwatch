import { Buffer } from "node:buffer";

import {
  AGENT_TEST_SET_SUFFIX,
  RUN_ACTOR_LABELS,
  type RunActor,
  SimulationRunStatus,
  VOICE_CALL_SCENARIO_SET_ID,
  type SimulationBatchHistory,
  type SimulationBatchRunData,
  type SimulationBatchSummary,
  type SimulationExportRun,
  type SimulationExternalSetSummary,
  type SimulationLastResultSummary,
  type SimulationRunData,
  type SimulationSetData,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

import type {
  SimulationRunState,
  SimulationRunStateData,
} from "../../eventing/simulation-run-state.projection.ts";
import { evaluationsToColumns } from "../../rules/simulation-evaluation-columns.rules.ts";
import {
  FULL_MESSAGES_PAGE_LIMIT,
  RUN_ID_CAP,
  SimulationClickHouseRepository,
} from "../clickhouse/simulation-clickhouse.repository.ts";
import { criteriaToColumns } from "../clickhouse/simulation-criteria.mapper.ts";
import {
  type ClickHouseSimulationRunRow,
  mapClickHouseRowToScenarioRunData,
  mapStatus,
} from "../clickhouse/simulation-run.mapper.ts";
import { SimulationRepository, type AllSimulationSuitesRunData } from "../simulation.repository.ts";
import type { MemorySimulationRunStateRepository } from "./memory.simulation-run-state.repository.ts";

const DEFAULT_SET_ID = "default";
const INTERNAL_SET_PREFIX = "__internal__";
const INTERNAL_SUITE_SUFFIX = "__suite";
const LIST_MESSAGE_LIMIT = 6;
const PREVIEW_MESSAGE_LIMIT = 4;
const FRESHNESS_FLOOR_MS = 30 * 24 * 60 * 60 * 1000;

/** The statuses a batch still owes work on; settled is their complement. */
const RUNNING_STATUSES = new Set([
  "IN_PROGRESS",
  "PENDING",
  "PENDING_EVALUATION",
  "QUEUED",
  "RUNNING",
]);
const FAILED_STATUSES = new Set(["FAILED", "FAILURE", "ERROR", "CANCELLED"]);
const COMPLETED_STATUSES = new Set(["SUCCESS", ...FAILED_STATUSES]);
/** A set summary counts a stalled run as failed; a batch aggregate does not. */
const SET_FAILED_STATUSES = new Set([...FAILED_STATUSES, "STALLED"]);

/** One run's latest fold, with the stored StartedAt resolved the way the live row stores it. */
interface FoldedRun {
  state: SimulationRunStateData;
  scenarioRunId: string;
  /** The live row stores the creation time for a run that never started. */
  startedAt: number;
}

interface DateWindow {
  startDate?: number;
  endDate?: number;
}

interface BatchAggregate {
  batchRunId: string;
  runs: FoldedRun[];
  totalCount: number;
  passCount: number;
  failCount: number;
  runningCount: number;
  settledCount: number;
  stalledCount: number;
  lastUpdatedAt: number;
  lastRunAt: number;
  firstCompletedAt: number;
  allCompletedAt: number;
  minStartedAt: number;
  maxStartedAt: number;
}

interface BatchCursor {
  ts: string;
  batchRunId: string;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function byCreatedAt(left: FoldedRun, right: FoldedRun): number {
  return (
    left.state.CreatedAt - right.state.CreatedAt ||
    compareText(left.scenarioRunId, right.scenarioRunId)
  );
}

function isVisible(run: FoldedRun): boolean {
  return run.state.ArchivedAt == null;
}

function normalizeSetId(scenarioSetId: string): string {
  return scenarioSetId === "" ? DEFAULT_SET_ID : scenarioSetId;
}

function expandSetIds(scenarioSetId: string): Set<string> {
  return scenarioSetId === DEFAULT_SET_ID || scenarioSetId === ""
    ? new Set([DEFAULT_SET_ID, ""])
    : new Set([scenarioSetId]);
}

function isAgentTestSet(scenarioSetId: string): boolean {
  return (
    scenarioSetId.endsWith(AGENT_TEST_SET_SUFFIX) || scenarioSetId === VOICE_CALL_SCENARIO_SET_ID
  );
}

function withinWindow({ at, window }: { at: number; window: DateWindow }): boolean {
  if (window.startDate !== undefined && at < window.startDate) return false;
  return window.endDate === undefined || at <= window.endDate;
}

function startedWithin({ run, window }: { run: FoldedRun; window: DateWindow }): boolean {
  return withinWindow({ at: run.startedAt, window });
}

/** A string at a JSON path of the run metadata, or '' as `JSONExtractString` answers. */
function metadataString({
  metadata,
  path,
}: {
  metadata: string | null;
  path: readonly string[];
}): string {
  if (!metadata) return "";
  let value: unknown;
  try {
    value = JSON.parse(metadata);
  } catch {
    return "";
  }
  for (const key of path) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return "";
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
    value = record[key];
  }
  return typeof value === "string" ? value : "";
}

function noteOf(run: FoldedRun): string {
  return metadataString({ metadata: run.state.Metadata, path: ["note"] });
}

function actorOf(run: FoldedRun): { id: string; label: string } {
  return {
    id: metadataString({ metadata: run.state.Metadata, path: ["langwatch", "actorId"] }),
    label: metadataString({ metadata: run.state.Metadata, path: ["langwatch", "actorLabel"] }),
  };
}

/** The batch's actor: the first run naming a person, as the live `anyIf` reads it. */
function deriveBatchActor(runs: FoldedRun[]): RunActor | null {
  const actor = runs.map(actorOf).find((candidate) => candidate.id !== "");
  if (!actor) return null;
  const label = RUN_ACTOR_LABELS.find((known) => known === actor.label);
  return label ? { id: actor.id, label } : null;
}

/** The row the live read selects; `trimmed` is the list projection, which drops the prose. */
function toRow({ run, trimmed }: { run: FoldedRun; trimmed: boolean }): ClickHouseSimulationRunRow {
  const { state } = run;
  const messages = trimmed ? state.Messages.slice(0, LIST_MESSAGE_LIMIT) : state.Messages;
  const evaluations = evaluationsToColumns(state.Evaluations);
  return {
    ScenarioRunId: run.scenarioRunId,
    ScenarioId: state.ScenarioId,
    BatchRunId: state.BatchRunId,
    ScenarioSetId: state.ScenarioSetId,
    Status: state.Status,
    Name: state.Name,
    Description: state.Description,
    Metadata: state.Metadata,
    "Messages.Id": messages.map((message) => message.Id),
    "Messages.Role": messages.map((message) => message.Role),
    "Messages.Content": messages.map((message) => message.Content),
    "Messages.TraceId": trimmed ? [] : messages.map((message) => message.TraceId),
    "Messages.Rest": trimmed ? [] : messages.map((message) => message.Rest),
    TraceIds: trimmed ? [] : state.TraceIds,
    Verdict: state.Verdict,
    Reasoning: trimmed ? null : state.Reasoning,
    MetCriteria: state.MetCriteria,
    UnmetCriteria: state.UnmetCriteria,
    InconclusiveCriteria: state.InconclusiveCriteria,
    Error: trimmed ? null : state.Error,
    ...evaluations,
    ...(trimmed && { "Evaluations.Details": [], "Evaluations.InputsJson": [] }),
    ...criteriaToColumns(state.Criteria ?? []),
    DurationMs: state.DurationMs == null ? null : String(state.DurationMs),
    TotalCost: state.TotalCost,
    RoleCosts: state.RoleCosts,
    RoleLatencies: state.RoleLatencies,
    StartedAt: String(run.startedAt),
    CreatedAt: String(state.CreatedAt),
    UpdatedAt: String(state.UpdatedAt),
    FinishedAt: state.FinishedAt == null ? null : String(state.FinishedAt),
    ArchivedAt: state.ArchivedAt == null ? null : String(state.ArchivedAt),
    ...(trimmed && { TotalMessageCount: String(state.Messages.length) }),
  };
}

function mapRun({ run, trimmed }: { run: FoldedRun; trimmed: boolean }): SimulationRunData {
  return mapClickHouseRowToScenarioRunData(toRow({ run, trimmed }));
}

function groupByBatch(runs: FoldedRun[]): Map<string, FoldedRun[]> {
  const byBatch = new Map<string, FoldedRun[]>();
  for (const run of runs) {
    const batch = byBatch.get(run.state.BatchRunId);
    if (batch) batch.push(run);
    else byBatch.set(run.state.BatchRunId, [run]);
  }
  return byBatch;
}

function aggregateBatch({
  batchRunId,
  runs,
}: {
  batchRunId: string;
  runs: FoldedRun[];
}): BatchAggregate {
  const statuses = runs.map((run) => run.state.Status);
  const runningCount = statuses.filter((status) => RUNNING_STATUSES.has(status)).length;
  const lastUpdatedAt = Math.max(0, ...runs.map((run) => run.state.UpdatedAt));
  const completedAt = runs
    .filter((run) => COMPLETED_STATUSES.has(run.state.Status))
    .map((run) => run.state.UpdatedAt);
  return {
    batchRunId,
    runs,
    totalCount: runs.length,
    passCount: statuses.filter((status) => status === "SUCCESS").length,
    failCount: statuses.filter((status) => FAILED_STATUSES.has(status)).length,
    runningCount,
    settledCount: runs.length - runningCount,
    stalledCount: statuses.filter((status) => status === "STALLED").length,
    lastUpdatedAt,
    lastRunAt: Math.max(0, ...runs.map((run) => run.state.CreatedAt)),
    firstCompletedAt: completedAt.length > 0 ? Math.min(...completedAt) : 0,
    allCompletedAt: runningCount === 0 ? lastUpdatedAt : 0,
    minStartedAt: Math.min(...runs.map((run) => run.startedAt)),
    maxStartedAt: Math.max(...runs.map((run) => run.startedAt)),
  };
}

function summaryCounts(
  batch: BatchAggregate,
): Omit<SimulationBatchSummary, "stalledCount" | "note" | "startedBy"> {
  return {
    batchRunId: batch.batchRunId,
    totalCount: batch.totalCount,
    passCount: batch.passCount,
    failCount: batch.failCount,
    runningCount: batch.runningCount,
    settledCount: batch.settledCount,
    lastRunAt: batch.lastRunAt,
    lastUpdatedAt: batch.lastUpdatedAt,
    firstCompletedAt: batch.firstCompletedAt > 0 ? batch.firstCompletedAt : null,
    allCompletedAt: batch.allCompletedAt > 0 ? batch.allCompletedAt : null,
  };
}

function previewItem(run: FoldedRun): SimulationBatchHistory["batches"][number]["items"][number] {
  const { state } = run;
  const hasFinished = state.FinishedAt != null && state.FinishedAt > 0;
  return {
    scenarioRunId: run.scenarioRunId,
    name: state.Name,
    description: state.Description,
    status: hasFinished ? mapStatus(state.Status) : SimulationRunStatus.IN_PROGRESS,
    durationInMs: state.DurationMs ?? 0,
    messagePreview: state.Messages.slice(0, PREVIEW_MESSAGE_LIMIT).map((message) => ({
      role: message.Role,
      content: message.Content,
    })),
  };
}

function encodeCursor(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function decodeCursor(cursor: string | undefined): Record<string, unknown> | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed));
  } catch {
    return null;
  }
}

function decodeBatchCursor(cursor: string | undefined): BatchCursor | null {
  const payload = decodeCursor(cursor);
  const ts = payload?.ts;
  const batchRunId = payload?.batchRunId;
  return typeof ts === "string" && typeof batchRunId === "string" ? { ts, batchRunId } : null;
}

function decodeExportCursor(
  cursor: string | undefined,
): { ts: string; scenarioRunId: string } | null {
  const payload = decodeCursor(cursor);
  const ts = payload?.ts;
  const scenarioRunId = payload?.scenarioRunId;
  return typeof ts === "string" && typeof scenarioRunId === "string" ? { ts, scenarioRunId } : null;
}

/**
 * One page of batches, newest `max(CreatedAt)` first, after the cursor and the window over each
 * batch's newest run. The runs are the ones the caller already scoped, as the live HAVING reads.
 */
function pageBatches({
  runs,
  cursor,
  window,
  limit,
}: {
  runs: FoldedRun[];
  cursor: BatchCursor | null;
  window: DateWindow;
  limit: number;
}): { page: BatchAggregate[]; hasMore: boolean; nextCursor?: string } {
  const cursorTs = cursor ? Number(cursor.ts) : null;
  const batches = [...groupByBatch(runs)]
    .map(([batchRunId, batchRuns]) => aggregateBatch({ batchRunId, runs: batchRuns }))
    .filter((batch) => {
      if (!withinWindow({ at: batch.lastRunAt, window })) return false;
      if (cursor === null || cursorTs === null) return true;
      if (batch.lastRunAt < cursorTs) return true;
      return batch.lastRunAt === cursorTs && batch.batchRunId > cursor.batchRunId;
    })
    .toSorted(
      (left, right) =>
        right.lastRunAt - left.lastRunAt || compareText(left.batchRunId, right.batchRunId),
    );
  const hasMore = batches.length > limit;
  const page = batches.slice(0, limit);
  const last = page.at(-1);
  return {
    page,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({ ts: String(last.lastRunAt), batchRunId: last.batchRunId })
        : undefined,
  };
}

/** A full-message page stops at a batch boundary, its cursor moved to the last batch kept. */
function capAtBatchBoundary({
  runs,
  page,
  nextCursor,
  hasMore,
}: {
  runs: SimulationRunData[];
  page: BatchAggregate[];
  nextCursor?: string;
  hasMore: boolean;
}): { runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean } {
  const capped = SimulationClickHouseRepository.capRunsAtBatchBoundary({
    runs,
    batchRunIds: page.map((batch) => batch.batchRunId),
    ceiling: FULL_MESSAGES_PAGE_LIMIT,
  });
  const lastKept = page[capped.batchesKept - 1];
  if (capped.batchesKept === page.length || !lastKept) {
    return { runs: capped.runs, nextCursor, hasMore };
  }
  return {
    runs: capped.runs,
    nextCursor: encodeCursor({ ts: String(lastKept.lastRunAt), batchRunId: lastKept.batchRunId }),
    hasMore: true,
  };
}

/**
 * The run reads over the memory run fold, the same fold `simulation_runs` holds on the live
 * tier. Each read answers what its ClickHouse twin answers for the latest version of every run;
 * the fold keeps one version per run, so no dedup is needed.
 */
export class MemorySimulationRepository extends SimulationRepository {
  static create({
    runs,
  }: {
    runs: MemorySimulationRunStateRepository<SimulationRunState>;
  }): MemorySimulationRepository {
    return new MemorySimulationRepository(runs);
  }

  private constructor(
    private readonly runs: MemorySimulationRunStateRepository<SimulationRunState>,
  ) {
    super();
  }

  private runsOf(tenantIds: readonly string[]): FoldedRun[] {
    return this.runs.findForTenants({ tenantIds }).map((projection) => ({
      state: projection.data,
      scenarioRunId: projection.aggregateId || projection.data.ScenarioRunId,
      startedAt: projection.data.StartedAt ?? projection.data.CreatedAt,
    }));
  }

  /** The visible runs of one project, optionally narrowed to a scenario set. */
  private visibleRuns({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId?: string;
  }): FoldedRun[] {
    const setIds = scenarioSetId === undefined ? null : expandSetIds(scenarioSetId);
    return this.runsOf([projectId]).filter(
      (run) => isVisible(run) && (setIds === null || setIds.has(run.state.ScenarioSetId)),
    );
  }

  /** The runs of the given batches, oldest first, trimmed unless whole conversations are asked. */
  private runsForBatches({
    projectId,
    batchRunIds,
    scenarioSetId,
    shouldIncludeMessages,
  }: {
    projectId: string;
    batchRunIds: string[];
    scenarioSetId?: string;
    shouldIncludeMessages: boolean;
  }): SimulationRunData[] {
    const wanted = new Set(batchRunIds);
    return this.visibleRuns({ projectId, scenarioSetId: scenarioSetId || undefined })
      .filter((run) => wanted.has(run.state.BatchRunId))
      .toSorted(byCreatedAt)
      .slice(0, 5000)
      .map((run) => mapRun({ run, trimmed: !shouldIncludeMessages }));
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
    const sets = new Map<string, SimulationSetData>();
    for (const run of this.visibleRuns({ projectId })) {
      if (isAgentTestSet(run.state.ScenarioSetId)) continue;
      if (!startedWithin({ run, window: { startDate, endDate } })) continue;
      const scenarioSetId = normalizeSetId(run.state.ScenarioSetId);
      const set = sets.get(scenarioSetId) ?? { scenarioSetId, scenarioCount: 0, lastRunAt: 0 };
      set.scenarioCount += 1;
      set.lastRunAt = Math.max(set.lastRunAt, run.state.UpdatedAt);
      sets.set(scenarioSetId, set);
    }
    return [...sets.values()].toSorted((left, right) => right.lastRunAt - left.lastRunAt);
  }

  async findScenarioRunData({
    projectId,
    scenarioRunId,
  }: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<SimulationRunData | null> {
    const run = this.visibleRuns({ projectId }).find(
      (candidate) => candidate.scenarioRunId === scenarioRunId,
    );
    return run ? mapRun({ run, trimmed: false }) : null;
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
    const window = { startDate, endDate };
    const setRuns = this.visibleRuns({ projectId, scenarioSetId });
    const inWindow = setRuns.filter((run) => startedWithin({ run, window }));
    const totalCount = new Set(inWindow.map((run) => run.state.BatchRunId)).size;
    const { page, hasMore, nextCursor } = pageBatches({
      runs: inWindow,
      cursor: decodeBatchCursor(cursor),
      window,
      limit: Math.min(Math.max(1, limit), 100),
    });
    if (page.length === 0) {
      return { batches: [], nextCursor: undefined, hasMore: false, lastUpdatedAt: 0, totalCount };
    }

    // The previews read the page's StartedAt window, not the caller's, as the live step 2 does.
    const bounds = SimulationClickHouseRepository.computeStartedAtBoundsForPage(
      page.map((batch) => ({
        MinStartedAt: String(batch.minStartedAt),
        MaxStartedAt: String(batch.maxStartedAt),
      })),
    );
    const previewWindow = bounds ? { startDate: bounds.minMs, endDate: bounds.maxMs } : {};
    const itemsByBatch = groupByBatch(
      setRuns.filter((run) => startedWithin({ run, window: previewWindow })).toSorted(byCreatedAt),
    );

    const batches = page.map((batch) => {
      const batchItems = itemsByBatch.get(batch.batchRunId) ?? [];
      const items = batchItems.map(previewItem);
      return {
        ...summaryCounts(batch),
        stalledCount: items.filter((item) => item.status === SimulationRunStatus.STALLED).length,
        note: batchItems.map(noteOf).find((note) => note !== "") ?? null,
        startedBy: deriveBatchActor(batchItems),
        items,
      };
    });
    return {
      batches,
      nextCursor,
      hasMore,
      lastUpdatedAt: Math.max(0, ...page.map((batch) => batch.lastUpdatedAt)),
      totalCount,
    };
  }

  async findBatchSummary({
    projectId,
    batchRunId,
  }: {
    projectId: string;
    batchRunId: string;
  }): Promise<SimulationBatchSummary | null> {
    const runs = this.visibleRuns({ projectId })
      .filter((run) => run.state.BatchRunId === batchRunId)
      .toSorted(byCreatedAt);
    if (runs.length === 0) return null;
    const batch = aggregateBatch({ batchRunId, runs });
    return {
      ...summaryCounts(batch),
      stalledCount: batch.stalledCount,
      note: runs.map(noteOf).find((note) => note !== "") ?? null,
      startedBy: deriveBatchActor(runs),
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
  }): Promise<SimulationBatchRunData> {
    if (sinceTimestamp !== undefined) {
      const lastUpdatedAt = Math.max(
        0,
        ...this.visibleRuns({ projectId })
          .filter((run) => run.state.BatchRunId === batchRunId)
          .map((run) => run.state.UpdatedAt),
      );
      if (lastUpdatedAt <= sinceTimestamp) return { changed: false, lastUpdatedAt };
    }

    // An empty set id is a real value (the default set); only an absent one drops the filter.
    const runs = this.visibleRuns({ projectId, scenarioSetId })
      .filter((run) => run.state.BatchRunId === batchRunId)
      .toSorted(byCreatedAt)
      .map((run) => mapRun({ run, trimmed: false }));
    const lastUpdatedAt = runs.reduce((max, run) => Math.max(max, run.timestamp), 0);
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
    const batches = this.visibleRuns({ projectId, scenarioSetId })
      .filter((run) => startedWithin({ run, window: { startDate, endDate } }))
      .map((run) => run.state.BatchRunId);
    return new Set(batches).size;
  }

  async findAllRunDataForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<SimulationRunData[]> {
    return this.visibleRuns({ projectId, scenarioSetId })
      .toSorted(
        (left, right) =>
          compareText(left.state.BatchRunId, right.state.BatchRunId) || byCreatedAt(left, right),
      )
      .slice(0, 10000)
      .map((run) => mapRun({ run, trimmed: false }));
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
  }): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }> {
    const window = { startDate, endDate };
    const { page, hasMore, nextCursor } = pageBatches({
      runs: this.visibleRuns({ projectId, scenarioSetId }).filter((run) =>
        startedWithin({ run, window }),
      ),
      cursor: decodeBatchCursor(cursor),
      window,
      limit: SimulationClickHouseRepository.clampPageLimit({ limit, shouldIncludeMessages }),
    });
    if (page.length === 0) return { runs: [], nextCursor: undefined, hasMore: false };

    const runs = this.runsForBatches({
      projectId,
      batchRunIds: page.map((batch) => batch.batchRunId),
      scenarioSetId,
      shouldIncludeMessages,
    });
    if (!shouldIncludeMessages) return { runs, nextCursor, hasMore };
    return capAtBatchBoundary({ runs, page, nextCursor, hasMore });
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
  }): Promise<AllSimulationSuitesRunData> {
    const listed = this.visibleRuns({ projectId }).filter(
      (run) => !isAgentTestSet(run.state.ScenarioSetId),
    );
    if (sinceTimestamp !== undefined) {
      const lastUpdatedAt = Math.max(0, ...listed.map((run) => run.state.UpdatedAt));
      if (lastUpdatedAt <= sinceTimestamp) return { changed: false, lastUpdatedAt };
    }

    const window = { startDate, endDate };
    const { page, hasMore, nextCursor } = pageBatches({
      runs: listed.filter((run) => startedWithin({ run, window })),
      cursor: decodeBatchCursor(cursor),
      window,
      limit: SimulationClickHouseRepository.clampPageLimit({ limit, shouldIncludeMessages }),
    });
    if (page.length === 0) {
      return {
        changed: true,
        lastUpdatedAt: 0,
        runs: [],
        scenarioSetIds: {},
        nextCursor: undefined,
        hasMore: false,
      };
    }

    const scenarioSetIds = Object.fromEntries(
      page.map((batch) => [
        batch.batchRunId,
        normalizeSetId(batch.runs[0]?.state.ScenarioSetId ?? ""),
      ]),
    );
    const runs = this.runsForBatches({
      projectId,
      batchRunIds: page.map((batch) => batch.batchRunId),
      shouldIncludeMessages,
    });
    const lastUpdatedAt = runs.reduce((max, run) => Math.max(max, run.timestamp), 0);
    if (!shouldIncludeMessages) {
      return { changed: true, lastUpdatedAt, runs, scenarioSetIds, nextCursor, hasMore };
    }
    return {
      changed: true,
      lastUpdatedAt,
      scenarioSetIds,
      ...capAtBatchBoundary({ runs, page, nextCursor, hasMore }),
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
    // Archived runs count: the live probe reads every version of the row, archived ones included.
    const window = {
      startDate: startDate ?? nowInstant().epochMilliseconds - FRESHNESS_FLOOR_MS,
      endDate,
    };
    const setIds = scenarioSetId ? expandSetIds(scenarioSetId) : null;
    const updated = this.runsOf([projectId])
      .filter((run) => setIds === null || setIds.has(run.state.ScenarioSetId))
      .filter((run) => startedWithin({ run, window }))
      .map((run) => run.state.UpdatedAt);
    return Math.max(0, ...updated);
  }

  async findExternalSetSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationExternalSetSummary[]> {
    return this.setSummaries({ ...params, filter: "external" });
  }

  async findInternalSuiteSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationExternalSetSummary[]> {
    return this.setSummaries({ ...params, filter: "internal-suites" });
  }

  /** Each set answers with the counts of its newest batch, by when that batch started. */
  private setSummaries({
    projectId,
    startDate,
    endDate,
    filter,
  }: {
    projectId: string;
    startDate?: number;
    endDate?: number;
    filter: "external" | "internal-suites";
  }): SimulationExternalSetSummary[] {
    const window = { startDate, endDate };
    const scoped = this.visibleRuns({ projectId }).filter((run) => {
      const setId = run.state.ScenarioSetId;
      const inScope =
        filter === "external"
          ? !setId.startsWith(INTERNAL_SET_PREFIX) && !isAgentTestSet(setId)
          : setId.startsWith(INTERNAL_SET_PREFIX) && setId.endsWith(INTERNAL_SUITE_SUFFIX);
      return inScope && startedWithin({ run, window });
    });

    const groups = new Map<string, { setId: string; runs: FoldedRun[] }>();
    for (const run of scoped) {
      const setId =
        filter === "external" ? normalizeSetId(run.state.ScenarioSetId) : run.state.ScenarioSetId;
      const key = JSON.stringify([setId, run.state.BatchRunId]);
      const group = groups.get(key) ?? { setId, runs: [] };
      group.runs.push(run);
      groups.set(key, group);
    }

    const sets = new Map<string, SimulationExternalSetSummary>();
    for (const { setId, runs } of groups.values()) {
      const lastCreatedAt = Math.max(...runs.map((run) => run.state.CreatedAt));
      if (!withinWindow({ at: lastCreatedAt, window })) continue;
      const minStartedAt = Math.min(...runs.map((run) => run.startedAt));
      const statuses = runs.map((run) => run.state.Status);
      const existing = sets.get(setId);
      if (existing && existing.lastRunTimestamp >= minStartedAt) continue;
      sets.set(setId, {
        scenarioSetId: setId,
        passedCount: statuses.filter((status) => status === "SUCCESS").length,
        failedCount: statuses.filter((status) => SET_FAILED_STATUSES.has(status)).length,
        totalCount: statuses.filter((status) => !RUNNING_STATUSES.has(status)).length,
        lastRunTimestamp: minStartedAt,
      });
    }
    return [...sets.values()].toSorted(
      (left, right) => right.lastRunTimestamp - left.lastRunTimestamp,
    );
  }

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
    if (scenarioIds !== undefined && scenarioIds.length === 0) return [];
    const wanted = scenarioIds === undefined ? null : new Set(scenarioIds);
    const window = { startDate, endDate };

    const byScenario = new Map<string, { latest: FoldedRun; lastRunAt: number }>();
    for (const run of this.visibleRuns({ projectId })) {
      const { ScenarioId: scenarioId, ScenarioSetId: setId } = run.state;
      if (scenarioId === "" || (wanted !== null && !wanted.has(scenarioId))) continue;
      if (isAgentTestSet(setId) || !startedWithin({ run, window })) continue;
      const seen = byScenario.get(scenarioId);
      byScenario.set(scenarioId, {
        latest: seen && seen.latest.state.UpdatedAt >= run.state.UpdatedAt ? seen.latest : run,
        lastRunAt: Math.max(seen?.lastRunAt ?? 0, run.startedAt),
      });
    }

    return [...byScenario].map(([scenarioId, { latest, lastRunAt }]) => ({
      scenarioId,
      status: mapStatus(latest.state.Status),
      metCriteriaCount: latest.state.MetCriteria.length,
      unmetCriteriaCount: latest.state.UnmetCriteria.length,
      lastRunAt,
      batchRunId: latest.state.BatchRunId,
      scenarioSetId: latest.state.ScenarioSetId,
      durationInMs: latest.state.DurationMs,
      totalCost: latest.state.TotalCost,
    }));
  }

  async findAllRunIdsForSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<{ runIds: string[]; reachedCap: boolean }> {
    const runIds = [
      ...new Set(this.visibleRuns({ projectId, scenarioSetId }).map((run) => run.scenarioRunId)),
    ].slice(0, RUN_ID_CAP);
    return { runIds, reachedCap: runIds.length === RUN_ID_CAP };
  }

  async findDistinctExternalSetIds({ projectIds }: { projectIds: string[] }): Promise<Set<string>> {
    const setIds = this.runsOf(projectIds)
      .filter(isVisible)
      .map((run) => run.state.ScenarioSetId)
      .filter((setId) => !setId.startsWith(INTERNAL_SET_PREFIX) && !isAgentTestSet(setId));
    return new Set(setIds.map(normalizeSetId));
  }

  async countRunsForExport(input: {
    projectId: string;
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number> {
    return this.exportScope(input).length;
  }

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<number> {
    return this.runsOf([...new Set(projectIds)]).filter(
      (run) => isVisible(run) && (since === undefined || run.startedAt >= since),
    ).length;
  }

  async countOrganizationRuns({ projectIds }: { projectIds: readonly string[] }): Promise<number> {
    return this.runsOf([...new Set(projectIds)]).filter(isVisible).length;
  }

  async listRunsForExport({
    limit,
    cursor,
    ...filters
  }: {
    projectId: string;
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
    limit: number;
    cursor?: string;
  }): Promise<{ runs: SimulationExportRun[]; nextCursor?: string; hasMore: boolean }> {
    const validatedLimit = Math.min(Math.max(1, limit), 500);
    const decoded = decodeExportCursor(cursor);
    const afterCursor = (run: FoldedRun): boolean => {
      if (!decoded) return true;
      const ts = Number(decoded.ts);
      return (
        run.startedAt > ts || (run.startedAt === ts && run.scenarioRunId > decoded.scenarioRunId)
      );
    };

    const sorted = this.exportScope(filters)
      .filter(afterCursor)
      .toSorted(
        (left, right) =>
          left.startedAt - right.startedAt || compareText(left.scenarioRunId, right.scenarioRunId),
      );
    const hasMore = sorted.length > validatedLimit;
    const page = sorted.slice(0, validatedLimit);
    const last = page.at(-1);
    return {
      runs: page.map((run) => ({
        ...mapRun({ run, trimmed: false }),
        scenarioSetId: normalizeSetId(run.state.ScenarioSetId),
        traceIds: run.state.TraceIds,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ ts: String(last.startedAt), scenarioRunId: last.scenarioRunId })
          : undefined,
      hasMore,
    };
  }

  /** The runs an export reads and counts: one filter definition for both. */
  private exportScope({
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
  }): FoldedRun[] {
    return this.visibleRuns({ projectId, scenarioSetId: scenarioSetId || undefined }).filter(
      (run) =>
        (!scenarioId || run.state.ScenarioId === scenarioId) &&
        startedWithin({ run, window: { startDate, endDate } }),
    );
  }
}
