import { createLogger } from "@langwatch/observability";
import { Temporal, nowInstant } from "@langwatch/time";
import {
  type BatchClusteringParams,
  CLUSTERING_ERROR_CODES,
  ClusteringError,
  type IncrementalClusteringParams,
  type TopicClusteringResponse,
  type TopicClusteringSubtopic,
  type TopicClusteringTopic,
  type TopicClusteringTrace,
  type TopicClusteringModels,
} from "@langwatch/topic-contract";
import type { TraceTopicAssignment } from "@langwatch/trace-contract";
import { z } from "zod";

import type {
  TopicClusteringClickHouse,
  TopicClusteringClickHouseResolver,
  TopicClusteringCommands,
  TopicClusteringLangevalsKind,
  TopicClusteringLangevals,
} from "../app/topic.members.ts";
import type { TopicClusteringRepository } from "../repositories/topic-clustering.repository.ts";
import {
  TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS,
  type TopicClusteringPageOutcome,
  type TopicClusteringRun,
} from "./topic-clustering.intent.ts";

const logger = createLogger("langwatch:topicClustering");

const DAY_MS = 24 * 60 * 60 * 1000;

/** The embeddings dimension the clustering params pin (text-embedding-3-small). */
const OPENAI_EMBEDDING_DIMENSION = 1536;

// 12-month look-back for batch-vs-incremental decision; narrowing flips mature-but-quiet projects
// into expensive full-batch re-cluster (measured: 49d threshold would flip 54 of 73 projects).
const CLUSTERING_MODE_WINDOW_DAYS = 365;

// Fetch window stays in ClickHouse hot tier to avoid cold reads that stalled the worker loop;
// trade-off: unassigned traces >49 days old are no longer retroactively clustered.
const CLUSTERING_FETCH_WINDOW_DAYS = 49;

// Hard deadline on langevals call derived from outbox lease to prevent concurrent runs
// destroying the model in batch mode; 60% of lease leaves room for response + store + outcome.
export const TOPIC_CLUSTERING_REQUEST_DEADLINE_MS = Math.floor(
  TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS * 0.6,
);

/** What one clustering page did; the run port's result. */
export type ClusteringPageOutcome = TopicClusteringPageOutcome;

/** Identity of the outbox dispatch driving this page; keys topic dedupe. */
export interface ClusteringRunContext {
  runId: string;
  page: number;
}

export interface ClusteringStoreSummary {
  topicsCount: number;
  subtopicsCount: number;
}

/**
 * Seeds one project's pre-ownership Topic rows onto its stream unless the
 * projection already owns the model. Structural (implemented by the
 * legacy-import migration) so the runner never depends on its construction.
 */
export interface TopicClusteringWritePathSeed {
  seedProjectTopicModel(projectId: string): Promise<"seeded" | "skipped">;
}

/**
 * The clustering runner's injected boundaries — built once in the
 * composition root and threaded through the page walk. No env, no global
 * Prisma, no app singletons past this point.
 */
export interface TopicClusteringRunnerDeps {
  resolveClickHouseClient: TopicClusteringClickHouseResolver;
  models: TopicClusteringModels;
  langevals: TopicClusteringLangevals;
  /**
   * The deployment's langevals base URL, or null when no clustering endpoint
   * is configured — the caller warns and the run skips as `not_configured`.
   */
  langevalsEndpoint: string | null;
  repository: TopicClusteringRepository;
  /** The legacy import, for the write-path topic-model seed guard. */
  migration: TopicClusteringWritePathSeed;
  commands: TopicClusteringCommands;
  traceAssignments: TraceTopicAssignment;
  /** Payload-size histogram observation per langevals call kind. */
  observePayloadSize: (kind: TopicClusteringLangevalsKind, sizeBytes: number) => void;
}

/** One process-owned runner instance for Eventing intents and manual tasks. */
export class TopicClusteringRunner implements TopicClusteringRun {
  static create(deps: TopicClusteringRunnerDeps): TopicClusteringRunner {
    return new TopicClusteringRunner(deps);
  }

  private constructor(private readonly deps: TopicClusteringRunnerDeps) {}

  runClusteringPage(params: {
    projectId: string;
    searchAfter: [number, string] | null;
    runId: string;
    page: number;
  }): Promise<TopicClusteringPageOutcome> {
    return clusterTopicsForProject(this.deps, {
      projectId: params.projectId,
      searchAfter: params.searchAfter ?? undefined,
      runContext: { runId: params.runId, page: params.page },
    });
  }
}

// Runs one clustering page; cadence gate throttles run STARTS only, not continuation pages.
// Caller owns continuing the walk; this function never schedules its own next page.
export const clusterTopicsForProject = async (
  deps: TopicClusteringRunnerDeps,
  {
    projectId,
    searchAfter,
    runContext,
  }: {
    projectId: string;
    searchAfter?: [number, string];
    runContext?: ClusteringRunContext;
  },
): Promise<ClusteringPageOutcome> => {
  const project = await deps.repository.findProject(projectId);
  if (!project) {
    throw new Error("Project not found");
  }

  let clickhouse: TopicClusteringClickHouse;
  try {
    clickhouse = await deps.resolveClickHouseClient(projectId);
  } catch {
    throw new Error(`ClickHouse client not available for project ${projectId}`);
  }

  const { totalTracesCount, recentTracesCount, assignedTracesCount } =
    await fetchCountsFromClickHouse({ clickhouse, projectId });

  logger.info(
    {
      projectId,
      totalTraces: totalTracesCount,
      recentTraces: recentTracesCount,
      backend: "clickhouse",
    },
    "Debug: Project trace counts",
  );

  const topics = await deps.repository.findTopicIndexRows(projectId);
  const topicIds = topics.filter((topic) => !topic.parentId).map((topic) => topic.id);
  const subtopicIds = topics.filter((topic) => topic.parentId).map((topic) => topic.id);

  // If topics exist and >=1200 traces are assigned, run incremental mode; check allows return to
  // batch mode if all topics for a project are deleted.
  const isIncrementalProcessing = topicIds.length > 0 && assignedTracesCount >= 1200;

  const lastTopicCreatedAt = topics.reduce(
    (acc, topic) => (Temporal.Instant.compare(topic.createdAt, acc) > 0 ? topic.createdAt : acc),
    Temporal.Instant.fromEpochMilliseconds(0),
  );

  // The cadence gate throttles run STARTS only — a continuation page
  // (searchAfter present) never re-takes it. Page 1 writes topics whose
  // createdAt is "now"; re-evaluating the gate on page 2 would read them as
  // "recently clustered" and stop the walk, silently truncating any backlog
  // larger than one page. The run was approved on page 1; later pages are the same run.
  let daysFrequency = 2;
  if (assignedTracesCount < 100) daysFrequency = 7;
  else if (assignedTracesCount < 500) daysFrequency = 3;
  const cadenceHorizon = nowInstant().subtract({
    milliseconds: daysFrequency * 24 * 60 * 60 * 1000,
  });
  const clusteredRecently = Temporal.Instant.compare(lastTopicCreatedAt, cadenceHorizon) > 0;
  if (!searchAfter && !isIncrementalProcessing && clusteredRecently) {
    logger.info(
      { projectId },
      `skipping clustering for project as last topic from batch processing was created less than ${daysFrequency} days ago`,
    );
    return {
      mode: "batch",
      tracesProcessed: 0,
      topicsCount: 0,
      subtopicsCount: 0,
      skippedReason: "recently_clustered",
    };
  }

  logger.info(
    {
      projectId,
      isIncrementalProcessing,
      topicIds: topicIds.length,
      subtopicIds: subtopicIds.length,
      assignedTracesCount,
      searchAfter,
    },
    "Starting trace search for topic clustering",
  );

  const { traces, lastSort, returnedCount } = await fetchTracesFromClickHouse({
    clickhouse,
    projectId,
    isIncrementalProcessing,
    topicIds,
    subtopicIds,
    searchAfter,
  });

  const minimumTraces = isIncrementalProcessing ? 1 : 10;

  logger.info(
    {
      projectId,
      finalTracesCount: traces.length,
      minimumTraces,
      isIncrementalProcessing,
    },
    "Final trace count for clustering",
  );

  const mode = isIncrementalProcessing ? "incremental" : "batch";

  // Keep paging while the page returned >10 raw rows (the legacy heuristic,
  // kept bit-identical — NOT "page was full", the CTE's 2000). Progress is
  // driven by the page boundary (returnedCount/lastSort), not the
  // post-filter usable count: older eligible traces can sit beyond a page of
  // empty/already-clustered ones, and stopping on usable count would strand them.
  const nextSearchAfter = returnedCount > 10 && lastSort ? lastSort : undefined;

  if (traces.length < minimumTraces) {
    logger.info(
      { projectId },
      `less than ${minimumTraces} usable traces on this page, skipping clustering but still paging`,
    );
    return {
      mode,
      tracesProcessed: 0,
      topicsCount: 0,
      subtopicsCount: 0,
      skippedReason: "not_enough_traces",
      ...(nextSearchAfter ? { nextSearchAfter } : {}),
    };
  }

  const summary = isIncrementalProcessing
    ? await incrementalClustering({ deps, projectId, traces, runContext })
    : await batchClusterTraces({ deps, projectId, traces, runContext });

  logger.info({ projectId }, "done! project");

  if (!summary) {
    // No topic model configured for this project/deployment — paging
    // further would keep hitting the same wall, so stop the walk here.
    return {
      mode,
      tracesProcessed: 0,
      topicsCount: 0,
      subtopicsCount: 0,
      skippedReason: "not_configured",
    };
  }

  return {
    mode,
    tracesProcessed: traces.length,
    topicsCount: summary.topicsCount,
    subtopicsCount: summary.subtopicsCount,
    ...(nextSearchAfter ? { nextSearchAfter } : {}),
  };
};

// --- ClickHouse read helpers ---

type TraceCounts = {
  totalTracesCount: number;
  recentTracesCount: number;
  assignedTracesCount: number;
};

type TraceSearchResult = {
  traces: TopicClusteringTrace[];
  lastSort: [number, string] | undefined;
  returnedCount: number;
};

const traceCountsRowSchema = z.object({
  total: z.string(),
  recent: z.string(),
  assigned: z.string(),
});

const tracePageRowSchema = z.object({
  TraceId: z.string(),
  ComputedInput: z.string().nullable(),
  TopicId: z.string().nullable(),
  SubTopicId: z.string().nullable(),
  OccurredAtMs: z.string(),
});

export async function fetchCountsFromClickHouse({
  clickhouse,
  projectId,
}: {
  clickhouse: TopicClusteringClickHouse;
  projectId: string;
}): Promise<TraceCounts> {
  const thirtyDaysAgo = nowInstant().epochMilliseconds - 30 * 24 * 60 * 60 * 1000;
  // Wide MODE window (kept at 365d): light-column scan that decides
  // batch-vs-incremental, so it must reflect the project's whole history.
  const twelveMonthsAgo = nowInstant().epochMilliseconds - CLUSTERING_MODE_WINDOW_DAYS * DAY_MS;

  // Fold to latest trace version in one GROUP BY pass (not IN-tuple dedup's two scans).
  // Assigned check uses TopicId boolean to handle NULL, so a cleared topic doesn't fold to stale.
  const result = await clickhouse.query({
    query: `
      SELECT
        toString(count(*)) AS total,
        toString(countIf(latestOccurredAt >= fromUnixTimestamp64Milli({thirtyDaysAgo:UInt64}))) AS recent,
        toString(countIf(latestAssigned)) AS assigned
      FROM (
        SELECT
          argMax(OccurredAt, UpdatedAt) AS latestOccurredAt,
          argMax(TopicId IS NOT NULL AND TopicId != '', UpdatedAt) AS latestAssigned
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64})
        GROUP BY TenantId, TraceId
      )
    `,
    query_params: { tenantId: projectId, thirtyDaysAgo, twelveMonthsAgo },
    format: "JSONEachRow",
  });

  const rows = z.array(traceCountsRowSchema).parse(await result.json());
  const row = rows[0];

  return {
    totalTracesCount: parseInt(row?.total ?? "0", 10),
    recentTracesCount: parseInt(row?.recent ?? "0", 10),
    assignedTracesCount: parseInt(row?.assigned ?? "0", 10),
  };
}

export async function fetchTracesFromClickHouse({
  clickhouse,
  projectId,
  isIncrementalProcessing,
  topicIds,
  subtopicIds,
  searchAfter,
}: {
  clickhouse: TopicClusteringClickHouse;
  projectId: string;
  isIncrementalProcessing: boolean;
  topicIds: string[];
  subtopicIds: string[];
  searchAfter?: [number, string];
}): Promise<TraceSearchResult> {
  // Narrow FETCH window (49d, hot-tier only): bounds how far cursor-paging
  // reads the heavy ComputedInput column, keeping it off S3 cold storage.
  const fetchWindowStartMs = nowInstant().epochMilliseconds - CLUSTERING_FETCH_WINDOW_DAYS * DAY_MS;

  // Page CTE selects <=2000 traces on key columns; outer query reads ComputedInput for selection
  // only. No outer ORDER BY/LIMIT/LIMIT 2000 to avoid buffering full rows (killed prod at 3.5 GiB).
  const pageHaving: string[] = [];

  if (isIncrementalProcessing && (topicIds.length > 0 || subtopicIds.length > 0)) {
    // Must either not have any of the known topics, or not have any of the known subtopics
    const topicCondition =
      topicIds.length > 0
        ? `(argMax(TopicId, UpdatedAt) IS NULL OR argMax(TopicId, UpdatedAt) NOT IN ({topicIds:Array(String)}))`
        : "1=1";
    const subtopicCondition =
      subtopicIds.length > 0
        ? `(argMax(SubTopicId, UpdatedAt) IS NULL OR argMax(SubTopicId, UpdatedAt) NOT IN ({subtopicIds:Array(String)}))`
        : "1=1";
    pageHaving.push(`(${topicCondition} OR ${subtopicCondition})`);
  }

  if (searchAfter) {
    // Mixed sort: OccurredAt DESC, TraceId ASC — tuple < doesn't work here.
    // Compare against the latest version's OccurredAt (argMax over UpdatedAt).
    pageHaving.push(`(
      toUnixTimestamp64Milli(argMax(OccurredAt, UpdatedAt)) < {lastTs:UInt64}
      OR (
        toUnixTimestamp64Milli(argMax(OccurredAt, UpdatedAt)) = {lastTs:UInt64}
        AND TraceId > {lastTraceId:String}
      )
    )`);
  }

  const pageHavingClause = pageHaving.length ? `HAVING ${pageHaving.join(" AND ")}` : "";

  const result = await clickhouse.query({
    query: `
      WITH page AS (
        SELECT TraceId
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({fetchWindowStartMs:UInt64})
          AND OccurredAt < now64(3)
        GROUP BY TenantId, TraceId
        ${pageHavingClause}
        ORDER BY argMax(OccurredAt, UpdatedAt) DESC, TraceId ASC
        LIMIT 2000
      )
      SELECT
        t.TraceId AS TraceId,
        t.ComputedInput AS ComputedInput,
        t.TopicId AS TopicId,
        t.SubTopicId AS SubTopicId,
        toString(toUnixTimestamp64Milli(t.OccurredAt)) AS OccurredAtMs
      FROM trace_summaries t
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= fromUnixTimestamp64Milli({fetchWindowStartMs:UInt64})
        AND OccurredAt < now64(3)
        AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
          SELECT TenantId, TraceId, max(UpdatedAt)
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fetchWindowStartMs:UInt64})
            AND OccurredAt < now64(3)
            AND TraceId IN (SELECT TraceId FROM page)
          GROUP BY TenantId, TraceId
        )
    `,
    query_params: {
      tenantId: projectId,
      fetchWindowStartMs,
      topicIds: topicIds.length > 0 ? topicIds : ["__none__"],
      subtopicIds: subtopicIds.length > 0 ? subtopicIds : ["__none__"],
      ...(searchAfter ? { lastTs: searchAfter[0], lastTraceId: searchAfter[1] } : {}),
    },
    format: "JSONEachRow",
    // The outer query reads ComputedInput (a potentially large payload) for a
    // page of <=2000 traces; peak memory scales with the number of read
    // streams holding one at once. Large-input tenants crossed
    // max_memory_usage_per_query here (MEMORY_LIMIT_EXCEEDED). This is a
    // background batch, not latency-critical, so read streams are capped; rows are unchanged.
    clickhouse_settings: { max_threads: 2 },
  });

  const rawRows = z.array(tracePageRowSchema).parse(await result.json());

  // Reapply the page ordering (OccurredAt DESC, TraceId ASC) in JS. The query
  // dropped its outer ORDER BY to avoid the top-N memory buffer (see above), so
  // rows now arrive in scan order; sort the small (<=2000) result set here so
  // the dedup-first-row and `lastSort` cursor logic below stay correct.
  rawRows.sort((a, b) => {
    const aTs = parseInt(a.OccurredAtMs, 10);
    const bTs = parseInt(b.OccurredAtMs, 10);
    if (aTs !== bTs) return bTs - aTs; // OccurredAt DESC
    if (a.TraceId < b.TraceId) return -1; // TraceId ASC
    if (a.TraceId > b.TraceId) return 1;
    return 0;
  });

  // Defensive de-dup by TraceId in JS, not SQL: the per-key SQL dedup
  // operator is banned in this path for OOM safety (it reads heavy columns
  // for the whole granule; see trace-dedup-oom-safety.unit.test). Rows are
  // ordered `OccurredAt DESC, TraceId ASC` above, so the first row per
  // TraceId is the one the boundary cursor should land on.
  const seenTraceIds = new Set<string>();
  const rows = rawRows.filter((row) => {
    if (seenTraceIds.has(row.TraceId)) return false;
    seenTraceIds.add(row.TraceId);
    return true;
  });

  const traces: TopicClusteringTrace[] = rows
    .map((row) => {
      const inputText = extractInputFromComputed(row.ComputedInput);
      if (!inputText || inputText === "<empty>") return null;

      return {
        trace_id: row.TraceId,
        input: inputText.slice(0, 8192),
        topic_id: row.TopicId && topicIds.includes(row.TopicId) ? row.TopicId : null,
        subtopic_id: row.SubTopicId && subtopicIds.includes(row.SubTopicId) ? row.SubTopicId : null,
      };
    })
    .filter((t): t is TopicClusteringTrace => t !== null);

  const lastRow = rows[rows.length - 1];
  const lastSort: [number, string] | undefined = lastRow
    ? [parseInt(lastRow.OccurredAtMs, 10), lastRow.TraceId]
    : undefined;

  return { traces, lastSort, returnedCount: rows.length };
}

/** The `input` a JSON-encoded value wraps, or the value itself when it wraps none. */
function unwrapInnerInput(value: string): string {
  try {
    const inner = JSON.parse(value);
    if (typeof inner?.input === "string" && inner.input.length > 0) return inner.input;
  } catch {
    // value is already a string
  }
  return value;
}

/** Extract text from a ComputedInput JSON string (mirrors getExtractedInput logic) */
function extractInputFromComputed(computedInput: string | null): string {
  if (!computedInput) return "<empty>";

  try {
    const parsed = JSON.parse(computedInput);
    // ComputedInput is typically the already-extracted input value as JSON
    if (typeof parsed === "string") return parsed || "<empty>";
    if (typeof parsed?.value === "string") return unwrapInnerInput(parsed.value) || "<empty>";
    if (typeof parsed?.input === "string") return parsed.input || "<empty>";
    return typeof parsed === "object" ? JSON.stringify(parsed) : String(parsed) || "<empty>";
  } catch {
    return computedInput || "<empty>";
  }
}

const getProjectTopicClusteringModelProvider = async (
  deps: TopicClusteringRunnerDeps,
  projectId: string,
) => {
  // Resolve the analytics.topic_clustering_llm feature via the models
  // port. Throws ModelNotConfiguredError when nothing is set at any scope;
  // nothing here catches it — it propagates to the intent handler, retries
  // through the outbox, and the run records run_failed with the
  // user-actionable model_not_configured code (settings-page guidance).
  const resolved = await deps.models.resolveClusteringModel(projectId);
  const topicClusteringModel = resolved.model;
  const provider = topicClusteringModel.split("/")[0];
  if (!provider) {
    throw new ClusteringError(
      CLUSTERING_ERROR_CODES.MODEL_NOT_CONFIGURED,
      `Topic clustering model "${topicClusteringModel}" has no provider prefix`,
    );
  }
  const modelProvider = (await deps.models.findExecutionProviders(projectId))[provider];
  if (!modelProvider) {
    throw new ClusteringError(
      CLUSTERING_ERROR_CODES.MODEL_NOT_CONFIGURED,
      `Topic clustering model provider ${provider} not found`,
    );
  }
  if (!modelProvider.enabled) {
    logger.info(
      { provider },
      "topic clustering model provider is not enabled, skipping topic clustering",
    );
    return;
  }

  return { model: topicClusteringModel, modelProvider };
};

export const batchClusterTraces = async ({
  deps,
  projectId,
  traces,
  runContext,
}: {
  deps: TopicClusteringRunnerDeps;
  projectId: string;
  traces: TopicClusteringTrace[];
  runContext?: ClusteringRunContext;
}): Promise<ClusteringStoreSummary | null> => {
  logger.info({ tracesLength: traces.length, projectId }, "batch clustering topics");

  const topicModel = await getProjectTopicClusteringModelProvider(deps, projectId);
  if (!topicModel) {
    return null;
  }
  const embeddingsModel = await deps.models.resolveEmbeddingsModel(projectId);
  const clusteringResult = await fetchTopicsBatchClustering(deps, projectId, {
    project_id: projectId,
    litellm_params: await deps.models.prepareLitellmParams({
      model: topicModel.model,
      modelProvider: topicModel.modelProvider,
      projectId,
    }),
    embeddings_litellm_params: {
      ...(await deps.models.prepareLitellmParams({
        model: embeddingsModel.model,
        modelProvider: embeddingsModel.modelProvider,
        projectId,
      })),
      dimensions: OPENAI_EMBEDDING_DIMENSION,
    },
    traces,
  });

  return storeResults({ deps, projectId, clusteringResult, isIncremental: false, runContext });
};

export const incrementalClustering = async ({
  deps,
  projectId,
  traces,
  runContext,
}: {
  deps: TopicClusteringRunnerDeps;
  projectId: string;
  traces: TopicClusteringTrace[];
  runContext?: ClusteringRunContext;
}): Promise<ClusteringStoreSummary | null> => {
  logger.info({ tracesLength: traces.length, projectId }, "incremental topic clustering");

  const topics: TopicClusteringTopic[] = (await deps.repository.findModelTopics(projectId)).map(
    (topic) => ({
      id: topic.id,
      name: topic.name,
      centroid: topic.centroid,
      p95_distance: topic.p95Distance,
    }),
  );

  const subtopics: TopicClusteringSubtopic[] = (
    await deps.repository.findModelSubtopics(projectId)
  ).map((topic) => ({
    id: topic.id,
    name: topic.name,
    centroid: topic.centroid,
    p95_distance: topic.p95Distance,
    parent_id: topic.parentId!,
  }));

  const topicModel = await getProjectTopicClusteringModelProvider(deps, projectId);
  if (!topicModel) {
    return null;
  }
  const embeddingsModel = await deps.models.resolveEmbeddingsModel(projectId);
  const clusteringResult = await fetchTopicsIncrementalClustering(deps, projectId, {
    project_id: projectId,
    litellm_params: await deps.models.prepareLitellmParams({
      model: topicModel.model,
      modelProvider: topicModel.modelProvider,
      projectId,
    }),
    embeddings_litellm_params: {
      ...(await deps.models.prepareLitellmParams({
        model: embeddingsModel.model,
        modelProvider: embeddingsModel.modelProvider,
        projectId,
      })),
      dimensions: OPENAI_EMBEDDING_DIMENSION,
    },
    traces,
    topics,
    subtopics,
  });

  return storeResults({ deps, projectId, clusteringResult, isIncremental: true, runContext });
};

const recordClusteredTopics = async ({
  deps,
  projectId,
  clusteringResult,
  isIncremental,
  runContext,
}: {
  deps: TopicClusteringRunnerDeps;
  projectId: string;
  clusteringResult: TopicClusteringResponse;
  isIncremental: boolean;
  runContext?: ClusteringRunContext;
}): Promise<void> => {
  const { topics, subtopics } = clusteringResult;
  const embeddingsModel = await deps.models.resolveEmbeddingsModel(projectId);
  // No clustering topics_recorded may be appended before the project's
  // pre-ownership history is on the stream: per-aggregate log order then
  // guarantees the seed folds first, so this event can never reconcile
  // the table down to just its own delta. Idempotent (`seed:v1`) and a
  // no-op once the projection owns the model.
  await deps.migration.seedProjectTopicModel(projectId);
  await deps.commands.recordTopics({
    tenantId: projectId,
    occurredAt: nowInstant().epochMilliseconds,
    mode: !isIncremental && topics.length > 0 ? "replace" : "merge",
    source: "clustering",
    dedupeKey: runContext
      ? `run:${runContext.runId}:page-${runContext.page}`
      : `adhoc:${nowInstant().epochMilliseconds}`,
    topics: [
      ...topics.map((topic) => ({
        id: topic.id,
        name: topic.name,
        parentId: null,
        embeddingsModel: embeddingsModel.model,
        centroid: topic.centroid,
        p95Distance: topic.p95_distance,
        automaticallyGenerated: true,
      })),
      ...subtopics.map((subtopic) => ({
        id: subtopic.id,
        name: subtopic.name,
        parentId: subtopic.parent_id,
        embeddingsModel: embeddingsModel.model,
        centroid: subtopic.centroid,
        p95Distance: subtopic.p95_distance,
        automaticallyGenerated: true,
      })),
    ],
  });
};

export const storeResults = async ({
  deps,
  projectId,
  clusteringResult,
  isIncremental,
  runContext,
}: {
  deps: TopicClusteringRunnerDeps;
  projectId: string;
  clusteringResult: TopicClusteringResponse | undefined;
  isIncremental: boolean;
  runContext?: ClusteringRunContext;
}): Promise<ClusteringStoreSummary | null> => {
  // No result is a skip, not an empty run: return null (not deleting the model if endpoint unset).
  if (!clusteringResult) {
    logger.warn(
      { projectId, isIncremental },
      "clustering returned no result; storing nothing and leaving the existing topic model untouched",
    );
    return null;
  }

  const { topics, subtopics, traces: tracesToAssign, cost } = clusteringResult;

  logger.info(
    {
      topicsLength: topics.length,
      subtopicsLength: subtopics.length,
      tracesToAssignLength: tracesToAssign.length,
      projectId,
    },
    "found new topics, subtopics and traces to assign for project",
  );

  // Batch mode replaces the model only when there's a new one (not leaving project empty).
  // Everything else merges; projection applies asynchronously (eventually consistent).
  if (topics.length > 0 || subtopics.length > 0) {
    await recordClusteredTopics({ deps, projectId, clusteringResult, isIncremental, runContext });
  }

  // Emit TopicAssignedEvents via command queue
  if (tracesToAssign.length > 0) {
    try {
      // Build topic name lookup maps
      const topicNameMap = new Map(topics.map((t) => [t.id, t.name]));
      const subtopicNameMap = new Map(subtopics.map((s) => [s.id, s.name]));

      // Send commands in parallel (queue handles batching internally)
      await Promise.all(
        tracesToAssign.map(({ trace_id, topic_id, subtopic_id }) =>
          deps.traceAssignments.assignTopic({
            tenantId: projectId,
            traceId: trace_id,
            topicId: topic_id,
            topicName: topic_id ? (topicNameMap.get(topic_id) ?? null) : null,
            subtopicId: subtopic_id,
            subtopicName: subtopic_id ? (subtopicNameMap.get(subtopic_id) ?? null) : null,
            isIncremental,
            occurredAt: nowInstant().epochMilliseconds,
          }),
        ),
      );

      logger.info(
        { projectId, commandsSent: tracesToAssign.length },
        "Sent AssignTopic commands to queue",
      );
    } catch (error) {
      logger.error({ projectId, error }, "Failed to send AssignTopic commands");
    }
  }

  if (cost) {
    await deps.repository.recordClusteringCost({
      projectId,
      amount: cost.amount,
      currency: cost.currency,
      tracesCount: tracesToAssign.length,
      topicsCount: topics.length,
      subtopicsCount: subtopics.length,
      isIncremental,
    });
  }

  return {
    topicsCount: topics.length,
    subtopicsCount: subtopics.length,
  };
};

export const fetchTopicsBatchClustering = async (
  deps: TopicClusteringRunnerDeps,
  projectId: string,
  params: BatchClusteringParams,
): Promise<TopicClusteringResponse | undefined> => {
  const baseUrl = deps.langevalsEndpoint;
  if (!baseUrl) {
    logger.warn({ projectId }, "Topic clustering service URL not set, skipping topic clustering");
    return;
  }

  const size = JSON.stringify(params).length;
  deps.observePayloadSize("topic_clustering_batch", size);

  logger.info(
    { sizeMb: size / 125000, projectId, engine: "langevals" },
    "uploading traces data for project",
  );

  return postToTopicClustering(deps, {
    projectId,
    url: `${baseUrl}/topics/batch_clustering`,
    body: params,
    kind: "topic_clustering_batch",
  });
};

export const fetchTopicsIncrementalClustering = async (
  deps: TopicClusteringRunnerDeps,
  projectId: string,
  params: IncrementalClusteringParams,
): Promise<TopicClusteringResponse | undefined> => {
  const baseUrl = deps.langevalsEndpoint;
  if (!baseUrl) {
    logger.warn({ projectId }, "Topic clustering service URL not set, skipping topic clustering");
    return;
  }

  const size = JSON.stringify(params).length;
  deps.observePayloadSize("topic_clustering_incremental", size);

  logger.info(
    { sizeMb: size / 125000, projectId, engine: "langevals" },
    "uploading traces data for project",
  );

  return postToTopicClustering(deps, {
    projectId,
    url: `${baseUrl}/topics/incremental_clustering`,
    body: params,
    kind: "topic_clustering_incremental",
  });
};

/**
 * The whole exchange lives inside the request deadline — staging upload,
 * request, and the body read.
 */
const postToTopicClustering = async (
  deps: TopicClusteringRunnerDeps,
  opts: {
    projectId: string;
    url: string;
    body: BatchClusteringParams | IncrementalClusteringParams;
    kind: TopicClusteringLangevalsKind;
  },
): Promise<TopicClusteringResponse> => {
  // Every clustering call carries a deadline — see
  // TOPIC_CLUSTERING_REQUEST_DEADLINE_MS for why an unbounded one is a
  // data-loss race, not just a slow request. An explicit controller (not
  // AbortSignal.timeout()) drives it via an ordinary timer, so tests can
  // advance it to exercise this branch for real instead of asserting around it.
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, TOPIC_CLUSTERING_REQUEST_DEADLINE_MS);
  deadline.unref?.();

  const label = opts.kind === "topic_clustering_batch" ? "batch" : "incremental";

  // The WHOLE exchange lives inside the deadline: staging upload, request,
  // and the body read. Clearing the timer as soon as fetch resolved left
  // response.json() unbounded — a streaming upstream that returns 200
  // headers then trickles a large body could outlive the 20-minute lease,
  // reopening exactly the double-lease race the deadline exists to prevent.
  try {
    const response = await deps.langevals.postClustering({
      url: opts.url,
      body: opts.body,
      projectId: opts.projectId,
      kind: opts.kind,
      signal: controller.signal,
    });

    if (!response.ok) {
      let body = await response.text();
      try {
        body = JSON.stringify(JSON.parse(body), null, 2).split("\n").slice(0, 10).join("\n");
      } catch {
        /* this is just a safe json parse fallback */
      }
      // Ours by default. The body often quotes an upstream provider error,
      // but quoting is not evidence — attributing a 5xx to the customer's
      // credentials on the strength of it is how this used to tell people
      // to rotate working keys during our own outages. Operators get the
      // detail in the message; the customer is told the code only.
      throw new ClusteringError(
        CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
        `Failed to fetch topics ${label} clustering (langevals): ${response.statusText}\n\n${body}`,
      );
    }

    return (await response.json()) as TopicClusteringResponse;
  } catch (error) {
    // Our own deadline firing is known at the throw site, so it's classified
    // here rather than guessed at from the message later (see
    // topic-clustering.errors.ts): ours, not the customer's, and worth
    // retrying — the outbox redelivers with a fresh deadline. A
    // ClusteringError from the !ok branch keeps its own identity regardless.
    if (controller.signal.aborted && !(error instanceof ClusteringError)) {
      logger.warn(
        {
          projectId: opts.projectId,
          kind: opts.kind,
          deadlineMs: TOPIC_CLUSTERING_REQUEST_DEADLINE_MS,
        },
        "Topic clustering request aborted at its deadline; failing the page so the outbox retries inside the lease",
      );
      throw new ClusteringError(
        CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
        `Topic clustering request to langevals exceeded its ${TOPIC_CLUSTERING_REQUEST_DEADLINE_MS}ms deadline (${opts.kind})`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(deadline);
  }
};
