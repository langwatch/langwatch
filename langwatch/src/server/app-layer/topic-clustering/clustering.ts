import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import { CostReferenceType, CostType, type Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { env } from "../../../env.mjs";
import { OPENAI_EMBEDDING_DIMENSION } from "../../../utils/constants";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../api/routers/modelProviders.utils";
import { getApp } from "../app";
import {
  CLUSTERING_ERROR_CODES,
  ClusteringError,
} from "./clustering-error";
import { getClickHouseClientForProject } from "../../clickhouse/clickhouseClient";
import { prisma } from "../../db";
import { getProjectEmbeddingsModel } from "../../embeddings";
import { stagedLangevalsFetch } from "../../langevals/stagedFetch";
import { getPayloadSizeHistogram } from "../../metrics";
import { resolveModelForFeature } from "../../modelProviders/resolveModelForFeature";
import { TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS } from "~/server/event-sourcing/pipelines/topic-clustering-processing/process-manager/topicClusteringIntentHandlers";
import type {
  BatchClusteringParams,
  IncrementalClusteringParams,
  TopicClusteringResponse,
  TopicClusteringSubtopic,
  TopicClusteringTopic,
  TopicClusteringTrace,
} from "./clustering.types";

const logger = createLogger("langwatch:topicClustering");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Look-back for the batch-vs-incremental MODE decision
 * (`fetchCountsFromClickHouse`). Deliberately wide: it answers "does this
 * project already have a mature topic model?", which depends on the project's
 * whole history, not just recent traffic. Narrowing it silently flips
 * historically-mature-but-quiet projects out of incremental mode into the
 * heavy full-batch re-cluster path — measured on prod, dropping this to 49d
 * would flip 54 of 73 incremental projects to batch. This query reads only
 * light key columns (no ComputedInput), so its scan stays cheap even across
 * cold-tier partitions.
 */
const CLUSTERING_MODE_WINDOW_DAYS = 365;

/**
 * Look-back for the trace FETCH (`fetchTracesFromClickHouse`) that reads the
 * heavy ComputedInput payload. Kept inside the ClickHouse hot tier (~90 days)
 * so cursor-paging never walks the payload column back into S3 cold storage —
 * the source of the multi-hundred-MB cold reads that stalled the worker event
 * loop. 49 days matches the retention recovery floor and sits comfortably
 * within hot. Trade-off: an unassigned trace older than 49 days is no longer
 * retroactively clustered; for the 2-day batch cadence and hot-tier ingest
 * this is negligible, and new/recent traffic (all within the window) is
 * unaffected.
 */
const CLUSTERING_FETCH_WINDOW_DAYS = 49;

/**
 * Hard deadline on a single langevals clustering call, DERIVED from the outbox
 * lease so the two cannot drift apart.
 *
 * The outbox leases a clustering intent for
 * {@link TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS}. A request with no client
 * deadline can outlive that lease; the row then becomes visible again, a second
 * replica leases it, and two runs cluster the same page concurrently. In batch
 * mode that is destructive, not merely wasteful: the second run's
 * delete-then-recreate in `storeResults` tears down the topic model the first
 * run is still writing into, and the first run's `createMany` lands against a
 * model the second one has already replaced.
 *
 * Sizing this comfortably below the lease makes that race structurally
 * impossible rather than unlikely — the call is aborted (and classified as a
 * retryable clustering-service failure) while the lease is still held, so the
 * message is redelivered through the outbox's own retry path with only one run
 * of this page ever in flight. 60% of the lease leaves ample room for response
 * handling, the store, and the outcome write to finish inside the remainder.
 */
export const TOPIC_CLUSTERING_REQUEST_DEADLINE_MS = Math.floor(
  TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS * 0.6,
);

/**
 * What one clustering page did (ADR-051). `nextSearchAfter` present means
 * the backlog has more pages — the caller owns continuing the walk (the
 * process manager via a continuation intent, or the CLI task via a loop);
 * this function never schedules its own next page.
 */
export interface ClusteringPageOutcome {
  mode: "batch" | "incremental";
  tracesProcessed: number;
  topicsCount: number;
  subtopicsCount: number;
  skippedReason?: "recently_clustered" | "not_enough_traces" | "not_configured";
  nextSearchAfter?: [number, string];
}

export const clusterTopicsForProject = async (
  projectId: string,
  searchAfter?: [number, string],
): Promise<ClusteringPageOutcome> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new Error("Project not found");
  }

  const clickhouse = await getClickHouseClientForProject(projectId);

  if (!clickhouse) {
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

  const topics = await prisma.topic.findMany({
    where: { projectId },
    select: { id: true, parentId: true, createdAt: true },
  });
  const topicIds = topics
    .filter((topic) => !topic.parentId)
    .map((topic) => topic.id);
  const subtopicIds = topics
    .filter((topic) => topic.parentId)
    .map((topic) => topic.id);

  // If we have topics and more than 1200 traces are already assigned, we are in incremental processing mode
  // This checks helps us getting back into batch mode if we simply delete all the topics for a given project
  const isIncrementalProcessing =
    topicIds.length > 0 && assignedTracesCount >= 1200;

  const lastTopicCreatedAt = topics.reduce((acc, topic) => {
    return topic.createdAt > acc ? topic.createdAt : acc;
  }, new Date(0));

  const daysFrequency =
    assignedTracesCount < 100 ? 7 : assignedTracesCount < 500 ? 3 : 2;
  if (
    !isIncrementalProcessing &&
    lastTopicCreatedAt >
      new Date(Date.now() - daysFrequency * 24 * 60 * 60 * 1000)
  ) {
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

  const { traces, lastSort, returnedCount } = await fetchTracesFromClickHouse(
    clickhouse,
    projectId,
    isIncrementalProcessing,
    topicIds,
    subtopicIds,
    searchAfter,
  );

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

  // Keep paging while the page returned more than a trivial handful of raw
  // rows (>10 — the legacy heuristic, kept bit-identical; NOT "page was
  // full", which would be the CTE's 2000). Progress is driven by the page
  // boundary (returnedCount / lastSort from the page CTE), not the
  // post-filter usable count — older eligible traces can sit beyond a page
  // of empty-input (or already-clustered) traces, and stopping on the
  // usable count would strand them. Worst case of the loose threshold is
  // one extra near-empty page before the walk ends.
  const nextSearchAfter =
    returnedCount > 10 && lastSort ? lastSort : undefined;

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
    ? await incrementalClustering(project, traces)
    : await batchClusterTraces(project, traces);

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

export async function fetchCountsFromClickHouse({
  clickhouse,
  projectId,
}: {
  clickhouse: ClickHouseClient;
  projectId: string;
}): Promise<TraceCounts> {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  // Wide MODE window (kept at 365d): light-column scan that decides
  // batch-vs-incremental, so it must reflect the project's whole history.
  const twelveMonthsAgo = Date.now() - CLUSTERING_MODE_WINDOW_DAYS * DAY_MS;

  // trace_summaries is a ReplacingMergeTree, so we count one row per trace
  // (its latest version). Rather than the IN-tuple dedup pattern — which
  // scans the 12-month window twice (once to build the latest-version key
  // set, once for the outer aggregate) and materialises a key set sized to
  // every trace — fold to the latest version in a single GROUP BY pass with
  // argMax(expr, UpdatedAt). The conditional counts read the latest version's
  // OccurredAt / assigned-state, identical to the previous shape, but with one
  // scan and no IN-set build. Light columns only (no heavy payloads).
  //
  // The assigned check folds over `argMax(TopicId IS NOT NULL AND TopicId !=
  // '', UpdatedAt)`, not `argMax(TopicId, UpdatedAt)`: TopicId is Nullable and
  // argMax skips rows whose first argument is NULL, so a trace whose latest
  // version cleared its topic (latest TopicId = NULL) would otherwise fold to
  // an older non-null TopicId and be over-counted. The boolean expression is
  // non-nullable, so the fold reads the true latest version.
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

  const rows = (await result.json()) as Array<{
    total: string;
    recent: string;
    assigned: string;
  }>;
  const row = rows[0];

  return {
    totalTracesCount: parseInt(row?.total ?? "0", 10),
    recentTracesCount: parseInt(row?.recent ?? "0", 10),
    assignedTracesCount: parseInt(row?.assigned ?? "0", 10),
  };
}

export async function fetchTracesFromClickHouse(
  clickhouse: ClickHouseClient,
  projectId: string,
  isIncrementalProcessing: boolean,
  topicIds: string[],
  subtopicIds: string[],
  searchAfter?: [number, string],
): Promise<TraceSearchResult> {
  // Narrow FETCH window (49d, hot-tier only): bounds how far cursor-paging
  // reads the heavy ComputedInput column, keeping it off S3 cold storage.
  const fetchWindowStartMs = Date.now() - CLUSTERING_FETCH_WINDOW_DAYS * DAY_MS;

  // Page selection runs on the lightweight key columns only: it picks the
  // 2000 most-recent matching traces without ever reading ComputedInput.
  // ComputedInput (a potentially large payload) is read in the outer query
  // for those <=2000 traces alone — never across the whole 12-month window,
  // which is what tipped this query into MEMORY_LIMIT_EXCEEDED. The topic
  // and cursor predicates run against the latest version of each trace
  // (argMax over UpdatedAt), so they live in the CTE's HAVING.
  //
  // The outer query deliberately does NOT filter on ComputedInput: empty /
  // null inputs are dropped downstream by `extractInputFromComputed`, while
  // the raw rows still carry the full page so `lastSort` (the pagination
  // cursor) tracks the page boundary. Filtering here would advance the cursor
  // by the surviving subset and could strand older eligible traces behind a
  // run of empty-input traces.
  //
  // The outer query also has NO `ORDER BY` and NO outer `LIMIT`. The page CTE
  // has already chosen the exact (<=2000) set of traces to return, so an outer
  // sort would only re-order that fixed set — but `ORDER BY ... LIMIT` makes
  // ClickHouse buffer a top-N of full rows, retaining every row's ComputedInput
  // payload at once. For tenants with large inputs that buffer alone exceeded
  // max_memory_usage_per_query (3.5 GiB) and the read failed with
  // MEMORY_LIMIT_EXCEEDED. Without the sort the rows stream out (ComputedInput
  // is read in small adaptive blocks and released), and the page ordering is
  // reapplied in JS over the small result set below.
  //
  // An outer `LIMIT 2000` is also omitted: it would cap physical rows *before*
  // the JS TraceId de-dupe, so if a trace had duplicate latest-version rows the
  // cap could drop other selected TraceIds and break `returnedCount`/`lastSort`
  // pagination. The page CTE bounds the result, so the cap is unnecessary.
  const pageHaving: string[] = [];

  if (
    isIncrementalProcessing &&
    (topicIds.length > 0 || subtopicIds.length > 0)
  ) {
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

  const pageHavingClause = pageHaving.length
    ? `HAVING ${pageHaving.join(" AND ")}`
    : "";

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
      ...(searchAfter
        ? { lastTs: searchAfter[0], lastTraceId: searchAfter[1] }
        : {}),
    },
    format: "JSONEachRow",
    // The outer query reads ComputedInput (a potentially large payload) for the
    // page of <=2000 traces. Even though rows stream (no outer sort/LIMIT), the
    // dedup still resolves the latest version per trace, and peak memory scales
    // with the number of read streams holding a ComputedInput block at once. For
    // tenants with large inputs that peak crossed max_memory_usage_per_query
    // (MEMORY_LIMIT_EXCEEDED). This is a background clustering batch, not a
    // latency-critical path, so cap the read streams to keep peak memory well
    // under the per-query limit; the returned rows are unchanged.
    clickhouse_settings: { max_threads: 2 },
  });

  const rawRows = (await result.json()) as Array<{
    TraceId: string;
    ComputedInput: string;
    TopicId: string | null;
    SubTopicId: string | null;
    OccurredAtMs: string;
  }>;

  // Reapply the page ordering (OccurredAt DESC, TraceId ASC) in JS. The query
  // dropped its outer ORDER BY to avoid the top-N memory buffer (see above), so
  // rows now arrive in scan order; sort the small (<=2000) result set here so
  // the dedup-first-row and `lastSort` cursor logic below stay correct.
  rawRows.sort((a, b) => {
    const aTs = parseInt(a.OccurredAtMs, 10);
    const bTs = parseInt(b.OccurredAtMs, 10);
    if (aTs !== bTs) return bTs - aTs; // OccurredAt DESC
    return a.TraceId < b.TraceId ? -1 : a.TraceId > b.TraceId ? 1 : 0; // TraceId ASC
  });

  // Defensive de-duplication by TraceId. The monotonic `UpdatedAt` invariant
  // should make `(TenantId, TraceId, max(UpdatedAt))` match exactly one row per
  // trace, but `returnedCount` / `lastSort` now drive pagination, so collapse
  // any same-version duplicate here in JS rather than at the SQL layer — the
  // per-key SQL dedup operator is banned in this path for OOM safety (it reads
  // heavy columns for the whole granule; see trace-dedup-oom-safety.unit.test).
  // Rows are ordered `OccurredAt DESC, TraceId ASC` (sorted above), so the first
  // row per TraceId is the one the boundary cursor should land on.
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
        topic_id:
          row.TopicId && topicIds.includes(row.TopicId) ? row.TopicId : null,
        subtopic_id:
          row.SubTopicId && subtopicIds.includes(row.SubTopicId)
            ? row.SubTopicId
            : null,
      };
    })
    .filter((t): t is TopicClusteringTrace => t !== null);

  const lastRow = rows[rows.length - 1];
  const lastSort: [number, string] | undefined = lastRow
    ? [parseInt(lastRow.OccurredAtMs, 10), lastRow.TraceId]
    : undefined;

  return { traces, lastSort, returnedCount: rows.length };
}

/** Extract text from a ComputedInput JSON string (mirrors getExtractedInput logic) */
function extractInputFromComputed(computedInput: string | null): string {
  if (!computedInput) return "<empty>";

  try {
    const parsed = JSON.parse(computedInput);
    // ComputedInput is typically the already-extracted input value as JSON
    if (typeof parsed === "string") return parsed || "<empty>";
    if (typeof parsed?.value === "string") {
      let value = parsed.value;
      try {
        const inner = JSON.parse(value);
        if (typeof inner?.input === "string" && inner.input.length > 0) {
          value = inner.input;
        }
      } catch {
        // value is already a string
      }
      return value || "<empty>";
    }
    if (typeof parsed?.input === "string") return parsed.input || "<empty>";
    return typeof parsed === "object"
      ? JSON.stringify(parsed)
      : String(parsed) || "<empty>";
  } catch {
    return computedInput || "<empty>";
  }
}

const getProjectTopicClusteringModelProvider = async (project: Project) => {
  // Resolve the analytics.topic_clustering_llm feature at the project's
  // cascade. Throws ModelNotConfiguredError when nothing is set at any
  // scope; the topic-clustering pipeline catches and skips clustering
  // for the run while logging the gap.
  const resolved = await resolveModelForFeature(
    "analytics.topic_clustering_llm",
    { prisma, projectId: project.id },
  );
  const topicClusteringModel = resolved.model;
  const provider = topicClusteringModel.split("/")[0];
  if (!provider) {
    throw new ClusteringError(
      CLUSTERING_ERROR_CODES.MODEL_NOT_CONFIGURED,
      `Topic clustering model "${topicClusteringModel}" has no provider prefix`,
    );
  }
  const modelProvider = (await getProjectModelProviders(project.id))[provider];
  if (!modelProvider) {
    throw new ClusteringError(
      CLUSTERING_ERROR_CODES.MODEL_NOT_CONFIGURED,
      `Topic clustering model provider ${provider} not found`,
    );
  }
  if (!modelProvider.enabled) {
    logger.info(
      { provider },
      "topic cluste ring model provider is not enabled, skipping topic clustering",
    );
    return;
  }

  return { model: topicClusteringModel, modelProvider };
};

export interface ClusteringStoreSummary {
  topicsCount: number;
  subtopicsCount: number;
}

export const batchClusterTraces = async (
  project: Project,
  traces: TopicClusteringTrace[],
): Promise<ClusteringStoreSummary | null> => {
  logger.info(
    { tracesLength: traces.length, projectId: project.id },
    "batch clustering topics",
  );

  const topicModel = await getProjectTopicClusteringModelProvider(project);
  if (!topicModel) {
    return null;
  }
  const embeddingsModel = await getProjectEmbeddingsModel(project.id);
  const clusteringResult = await fetchTopicsBatchClustering(project.id, {
    project_id: project.id,
    litellm_params: await prepareLitellmParams({
      model: topicModel.model,
      modelProvider: topicModel.modelProvider,
      projectId: project.id,
    }),
    embeddings_litellm_params: {
      ...(await prepareLitellmParams({
        model: embeddingsModel.model,
        modelProvider: embeddingsModel.modelProvider,
        projectId: project.id,
      })),
      dimensions: OPENAI_EMBEDDING_DIMENSION,
    },
    traces,
  });

  return await storeResults(project.id, clusteringResult, false);
};

export const incrementalClustering = async (
  project: Project,
  traces: TopicClusteringTrace[],
): Promise<ClusteringStoreSummary | null> => {
  logger.info(
    { tracesLength: traces.length, projectId: project.id },
    "incremental topic clustering",
  );

  const topics: TopicClusteringTopic[] = (
    await prisma.topic.findMany({
      where: { projectId: project.id, parentId: null },
      select: { id: true, name: true, centroid: true, p95Distance: true },
    })
  ).map((topic) => ({
    id: topic.id,
    name: topic.name,
    centroid: topic.centroid as number[],
    p95_distance: topic.p95Distance,
  }));

  const subtopics: TopicClusteringSubtopic[] = (
    await prisma.topic.findMany({
      where: { projectId: project.id, parentId: { not: null } },
      select: {
        id: true,
        name: true,
        centroid: true,
        p95Distance: true,
        parentId: true,
      },
    })
  ).map((topic) => ({
    id: topic.id,
    name: topic.name,
    centroid: topic.centroid as number[],
    p95_distance: topic.p95Distance,
    parent_id: topic.parentId!,
  }));

  const topicModel = await getProjectTopicClusteringModelProvider(project);
  if (!topicModel) {
    return null;
  }
  const embeddingsModel = await getProjectEmbeddingsModel(project.id);
  const clusteringResult = await fetchTopicsIncrementalClustering(project.id, {
    project_id: project.id,
    litellm_params: await prepareLitellmParams({
      model: topicModel.model,
      modelProvider: topicModel.modelProvider,
      projectId: project.id,
    }),
    embeddings_litellm_params: {
      ...(await prepareLitellmParams({
        model: embeddingsModel.model,
        modelProvider: embeddingsModel.modelProvider,
        projectId: project.id,
      })),
      dimensions: OPENAI_EMBEDDING_DIMENSION,
    },
    traces,
    topics,
    subtopics,
  });

  return await storeResults(project.id, clusteringResult, true);
};

export const storeResults = async (
  projectId: string,
  clusteringResult: TopicClusteringResponse | undefined,
  isIncremental: boolean,
): Promise<ClusteringStoreSummary | null> => {
  // NO RESULT IS A SKIP, NOT AN EMPTY CLUSTERING.
  //
  // This used to default an absent result to empty arrays and fall through.
  // In batch mode that walked straight into the delete-then-recreate below,
  // wiping the project's entire topic model and writing nothing back — and it
  // still returned a summary, so the caller's `not_configured` skip was
  // unreachable and the run was recorded as "completed, 0 topics" moments
  // after destroying the model. `fetchTopics*Clustering` returns undefined
  // whenever LANGEVALS_ENDPOINT is unset, so on any deployment without a
  // clustering endpoint that was every batch run.
  //
  // Returning null makes it a true no-op: no delete, no writes, and the
  // callers report it as a skip rather than a successful empty run.
  if (!clusteringResult) {
    logger.warn(
      { projectId, isIncremental },
      "clustering returned no result; storing nothing and leaving the existing topic model untouched",
    );
    return null;
  }

  const {
    topics,
    subtopics,
    traces: tracesToAssign,
    cost,
  } = clusteringResult;

  logger.info(
    {
      topicsLength: topics.length,
      subtopicsLength: subtopics.length,
      tracesToAssignLength: Object.keys(tracesToAssign).length,
      projectId,
    },
    "found new topics, subtopics and traces to assign for project",
  );

  // Batch mode REPLACES the topic model, so it deletes the old one first.
  // Only ever do that when there is a new model to put back: an empty result
  // from an otherwise successful call would leave the project with no topics
  // at all, which is strictly worse than keeping the previous ones. The delete
  // and the createMany below are not one transaction, so an empty delete is a
  // permanent loss, not a rollback.
  if (!isIncremental && topics.length > 0) {
    await prisma.topic.deleteMany({
      where: { projectId, parentId: { not: null } },
    });
    await prisma.topic.deleteMany({
      where: { projectId },
    });
  }

  const embeddingsModel = await getProjectEmbeddingsModel(projectId);

  if (topics.length > 0) {
    await prisma.topic.createMany({
      data: topics.map((topic) => ({
        id: topic.id,
        projectId,
        name: topic.name,
        embeddings_model: embeddingsModel.model,
        centroid: topic.centroid,
        p95Distance: topic.p95_distance,
        automaticallyGenerated: true,
      })),
      skipDuplicates: true,
    });
  }
  if (subtopics.length > 0) {
    await prisma.topic.createMany({
      data: subtopics.map((subtopic) => ({
        id: subtopic.id,
        projectId,
        name: subtopic.name,
        embeddings_model: embeddingsModel.model,
        centroid: subtopic.centroid,
        p95Distance: subtopic.p95_distance,
        parentId: subtopic.parent_id,
        automaticallyGenerated: true,
      })),
      skipDuplicates: true,
    });
  }

  // Emit TopicAssignedEvents via command queue
  if (tracesToAssign.length > 0) {
    try {
      const app = getApp();

      // Build topic name lookup maps
      const topicNameMap = new Map(topics.map((t) => [t.id, t.name]));
      const subtopicNameMap = new Map(subtopics.map((s) => [s.id, s.name]));

      // Send commands in parallel (queue handles batching internally)
      await Promise.all(
        tracesToAssign.map(({ trace_id, topic_id, subtopic_id }) =>
          app.traces.assignTopic({
            tenantId: projectId,
            traceId: trace_id,
            topicId: topic_id,
            topicName: topic_id ? (topicNameMap.get(topic_id) ?? null) : null,
            subtopicId: subtopic_id,
            subtopicName: subtopic_id
              ? (subtopicNameMap.get(subtopic_id) ?? null)
              : null,
            isIncremental,
            occurredAt: Date.now(),
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
    await prisma.cost.create({
      data: {
        id: `cost_${nanoid()}`,
        projectId: projectId,
        costType: CostType.CLUSTERING,
        costName: "Topics Clustering",
        referenceType: CostReferenceType.PROJECT,
        referenceId: projectId,
        amount: cost.amount,
        currency: cost.currency,
        extraInfo: {
          traces_count: tracesToAssign.length,
          topics_count: Object.keys(topics).length,
          subtopics_count: Object.keys(subtopics).length,
          is_incremental: isIncremental,
        },
      },
    });
  }

  return {
    topicsCount: topics.length,
    subtopicsCount: subtopics.length,
  };
};

/**
 * Topic clustering runs on langevals (the workspace member at
 * langevals/evaluators/topic_clustering — see contract.md §11). Returns
 * the base URL, or `null` if LANGEVALS_ENDPOINT is unset, in which case
 * the caller warns and skips.
 */
const resolveTopicClusteringEndpoint = (): string | null => {
  return env.LANGEVALS_ENDPOINT ?? null;
};

export const fetchTopicsBatchClustering = async (
  projectId: string,
  params: BatchClusteringParams,
): Promise<TopicClusteringResponse | undefined> => {
  const baseUrl = resolveTopicClusteringEndpoint();
  if (!baseUrl) {
    logger.warn(
      { projectId },
      "Topic clustering service URL not set, skipping topic clustering",
    );
    return;
  }

  const size = JSON.stringify(params).length;
  getPayloadSizeHistogram("topic_clustering_batch").observe(size);

  logger.info(
    { sizeMb: size / 125000, projectId, engine: "langevals" },
    "uploading traces data for project",
  );

  return await postToTopicClustering({
    projectId,
    url: `${baseUrl}/topics/batch_clustering`,
    body: params,
    kind: "topic_clustering_batch",
  });
};

export const fetchTopicsIncrementalClustering = async (
  projectId: string,
  params: IncrementalClusteringParams,
): Promise<TopicClusteringResponse | undefined> => {
  const baseUrl = resolveTopicClusteringEndpoint();
  if (!baseUrl) {
    logger.warn(
      { projectId },
      "Topic clustering service URL not set, skipping topic clustering",
    );
    return;
  }

  const size = JSON.stringify(params).length;
  getPayloadSizeHistogram("topic_clustering_incremental").observe(size);

  logger.info(
    { sizeMb: size / 125000, projectId, engine: "langevals" },
    "uploading traces data for project",
  );

  return await postToTopicClustering({
    projectId,
    url: `${baseUrl}/topics/incremental_clustering`,
    body: params,
    kind: "topic_clustering_incremental",
  });
};

/**
 * langevals runs on AWS Lambda, which hard-caps sync invokes at 6 MB; we
 * stage anything past LANGEVALS_STAGING_THRESHOLD_BYTES to S3 and pass
 * the presigned URL via X-Payload-S3-URL.
 */
const postToTopicClustering = async (opts: {
  projectId: string;
  url: string;
  body: BatchClusteringParams | IncrementalClusteringParams;
  kind: "topic_clustering_batch" | "topic_clustering_incremental";
}): Promise<TopicClusteringResponse> => {
  // Every clustering call carries a deadline — see
  // TOPIC_CLUSTERING_REQUEST_DEADLINE_MS for why an unbounded one is a
  // data-loss race and not just a slow request.
  //
  // An explicit controller rather than AbortSignal.timeout(): the deadline is
  // then driven by an ordinary timer, which tests can advance to exercise this
  // branch for real instead of asserting around it.
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, TOPIC_CLUSTERING_REQUEST_DEADLINE_MS);
  deadline.unref?.();

  const label =
    opts.kind === "topic_clustering_batch" ? "batch" : "incremental";

  // The WHOLE exchange lives inside the deadline: staging upload, request,
  // and the body read. Clearing the timer as soon as fetch resolved left
  // response.json() unbounded — a streaming upstream that returns 200
  // headers then trickles a large body could outlive the 20-minute lease,
  // reopening exactly the double-lease race the deadline exists to prevent.
  try {
    const response = await stagedLangevalsFetch({
      url: opts.url,
      body: opts.body,
      projectId: opts.projectId,
      kind: opts.kind,
      signal: controller.signal,
    });

    if (!response.ok) {
      let body = await response.text();
      try {
        body = JSON.stringify(JSON.parse(body), null, 2)
          .split("\n")
          .slice(0, 10)
          .join("\n");
      } catch {
        /* this is just a safe json parse fallback */
      }
      // Ours by default. The body often quotes an upstream provider error,
      // but quoting is not evidence — attributing a 5xx to the customer's
      // credentials on the strength of the text inside it is how this used to
      // tell people to rotate working keys during our own outages. The
      // message keeps the detail for operators; the customer is told the code
      // only.
      throw new ClusteringError(
        CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
        `Failed to fetch topics ${label} clustering (langevals): ${response.statusText}\n\n${body}`,
      );
    }

    return (await response.json()) as TopicClusteringResponse;
  } catch (error) {
    // Our own deadline firing is a fact we know at the throw site, so it is
    // classified here rather than guessed at from the message later (see
    // clustering-error.ts). It is the clustering service failing to answer in
    // time — ours, not the customer's, and worth retrying: the outbox
    // redelivers the intent and the next attempt gets a fresh deadline.
    // A ClusteringError from the !ok branch keeps its own (identically
    // retryable) identity even if the timer happens to fire while it unwinds.
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
