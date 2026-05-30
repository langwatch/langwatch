import type { ClickHouseClient } from "@clickhouse/client";
import { CostReferenceType, CostType, type Project } from "@prisma/client";
import { fetch as fetchHTTP2 } from "fetch-h2";
import { nanoid } from "nanoid";
import { env } from "../../env.mjs";
import { OPENAI_EMBEDDING_DIMENSION } from "../../utils/constants";
import { resolveModelForFeature } from "../modelProviders/resolveModelForFeature";
import { createLogger } from "../../utils/logger/server";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../api/routers/modelProviders.utils";
import { getApp } from "../app-layer/app";
import { scheduleTopicClusteringNextPage } from "../background/queues/topicClusteringQueue";
import { getClickHouseClientForProject } from "../clickhouse/clickhouseClient";
import { prisma } from "../db";
import { getProjectEmbeddingsModel } from "../embeddings";
import { getPayloadSizeHistogram } from "../metrics";
import { stagedLangevalsFetch } from "../langevals/stagedFetch";
import { isNlpGoEnabled } from "../nlpgo/nlpgoFetch";
import type {
  BatchClusteringParams,
  IncrementalClusteringParams,
  TopicClusteringResponse,
  TopicClusteringSubtopic,
  TopicClusteringTopic,
  TopicClusteringTrace,
  TopicClusteringTraceTopicMap,
} from "./types";

const logger = createLogger("langwatch:topicClustering");

export const clusterTopicsForProject = async (
  projectId: string,
  searchAfter?: [number, string],
  scheduleNextPage = true,
): Promise<void> => {
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

  const { totalTracesCount, tracesWithInputCount, recentTracesCount, assignedTracesCount } =
    await fetchCountsFromClickHouse(clickhouse, projectId);

  logger.info(
    {
      projectId,
      totalTraces: totalTracesCount,
      tracesWithInput: tracesWithInputCount,
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
    assignedTracesCount < 100
      ? 7
      : assignedTracesCount < 500
        ? 3
        : 2;
  if (
    !isIncrementalProcessing &&
    lastTopicCreatedAt >
      new Date(Date.now() - daysFrequency * 24 * 60 * 60 * 1000)
  ) {
    logger.info(
      { projectId },
      `skipping clustering for project as last topic from batch processing was created less than ${daysFrequency} days ago`,
    );
    return;
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

  if (traces.length < minimumTraces) {
    logger.info(
      { projectId },
      `less than ${minimumTraces} traces found for project, skipping topic clustering`,
    );
    return;
  }

  if (isIncrementalProcessing) {
    await incrementalClustering(project, traces);
  } else {
    await batchClusterTraces(project, traces);
  }

  // If results are not close to empty, schedule the seek for next page
  if (returnedCount > 10 && lastSort) {
    logger.info(
      { projectId, lastTraceSort: lastSort },
      "scheduling the next page for clustering",
    );
    if (scheduleNextPage) {
      await scheduleTopicClusteringNextPage(projectId, lastSort);
    } else {
      logger.info(
        { projectId, lastTraceSort: lastSort },
        "skipping scheduling next page for project",
      );
    }
  }

  logger.info({ projectId }, "done! project");
};

// --- ClickHouse read helpers ---

type TraceCounts = {
  totalTracesCount: number;
  tracesWithInputCount: number;
  recentTracesCount: number;
  assignedTracesCount: number;
};

type TraceSearchResult = {
  traces: TopicClusteringTrace[];
  lastSort: [number, string] | undefined;
  returnedCount: number;
};

async function fetchCountsFromClickHouse(
  clickhouse: ClickHouseClient,
  projectId: string,
): Promise<TraceCounts> {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const twelveMonthsAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;

  const result = await clickhouse.query({
    query: `
      SELECT
        toString(count(*)) AS total,
        toString(countIf(length(ComputedInput) > 0)) AS withInput,
        toString(countIf(OccurredAt >= fromUnixTimestamp64Milli({thirtyDaysAgo:UInt64}))) AS recent,
        toString(countIf(TopicId IS NOT NULL AND TopicId != '')) AS assigned
      FROM trace_summaries t
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64})
        AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
          SELECT TenantId, TraceId, max(UpdatedAt)
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
    withInput: string;
    recent: string;
    assigned: string;
  }>;
  const row = rows[0];

  return {
    totalTracesCount: parseInt(row?.total ?? "0", 10),
    tracesWithInputCount: parseInt(row?.withInput ?? "0", 10),
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
  const twelveMonthsAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;

  // Page selection runs on the lightweight key columns only: it picks the
  // 2000 most-recent matching traces without ever reading ComputedInput.
  // ComputedInput (a potentially large payload) is read in the outer query
  // for those <=2000 traces alone — never across the whole 12-month window,
  // which is what tipped this query into MEMORY_LIMIT_EXCEEDED. The topic
  // and cursor predicates run against the latest version of each trace
  // (argMax over UpdatedAt), so they live in the CTE's HAVING.
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

  const pageHavingClause = pageHaving.length
    ? `HAVING ${pageHaving.join(" AND ")}`
    : "";

  const result = await clickhouse.query({
    query: `
      WITH page AS (
        SELECT TraceId
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64})
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
        AND OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64})
        AND OccurredAt < now64(3)
        AND ComputedInput IS NOT NULL
        AND ComputedInput != ''
        AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
          SELECT TenantId, TraceId, max(UpdatedAt)
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND TraceId IN (SELECT TraceId FROM page)
          GROUP BY TenantId, TraceId
        )
      ORDER BY t.OccurredAt DESC, t.TraceId ASC
      LIMIT 2000
    `,
    query_params: {
      tenantId: projectId,
      twelveMonthsAgo,
      topicIds: topicIds.length > 0 ? topicIds : ["__none__"],
      subtopicIds: subtopicIds.length > 0 ? subtopicIds : ["__none__"],
      ...(searchAfter
        ? { lastTs: searchAfter[0], lastTraceId: searchAfter[1] }
        : {}),
    },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as Array<{
    TraceId: string;
    ComputedInput: string;
    TopicId: string | null;
    SubTopicId: string | null;
    OccurredAtMs: string;
  }>;

  const traces: TopicClusteringTrace[] = rows
    .map((row) => {
      const inputText = extractInputFromComputed(row.ComputedInput);
      if (!inputText || inputText === "<empty>") return null;

      return {
        trace_id: row.TraceId,
        input: inputText.slice(0, 8192),
        topic_id:
          row.TopicId && topicIds.includes(row.TopicId)
            ? row.TopicId
            : null,
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
    throw new Error("Topic clustering provider not set");
  }
  const modelProvider = (await getProjectModelProviders(project.id))[provider];
  if (!modelProvider) {
    throw new Error(`Topic clustering model provider ${provider} not found`);
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

export const batchClusterTraces = async (
  project: Project,
  traces: TopicClusteringTrace[],
) => {
  logger.info(
    { tracesLength: traces.length, projectId: project.id },
    "batch clustering topics",
  );

  const topicModel = await getProjectTopicClusteringModelProvider(project);
  if (!topicModel) {
    return;
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

  await storeResults(project.id, clusteringResult, false);
};

export const incrementalClustering = async (
  project: Project,
  traces: TopicClusteringTrace[],
) => {
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
    return;
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

  await storeResults(project.id, clusteringResult, true);
};

export const storeResults = async (
  projectId: string,
  clusteringResult: TopicClusteringResponse | undefined,
  isIncremental: boolean,
) => {
  const {
    topics,
    subtopics,
    traces: tracesToAssign,
    cost,
  } = clusteringResult ?? {
    topics: [] as TopicClusteringTopic[],
    subtopics: [] as TopicClusteringSubtopic[],
    traces: [] as TopicClusteringTraceTopicMap[],
    cost: undefined,
  };

  logger.info(
    {
      topicsLength: topics.length,
      subtopicsLength: subtopics.length,
      tracesToAssignLength: Object.keys(tracesToAssign).length,
      projectId,
    },
    "found new topics, subtopics and traces to assign for project",
  );

  if (!isIncremental) {
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
};

/**
 * Resolve which service hosts topic clustering for the given project. When
 * `release_nlp_go_engine_enabled` is on, route to langevals (the new
 * workspace member at langevals/evaluators/topic_clustering — see
 * specs/nlp-go/_shared/contract.md §11). When off, the legacy langwatch_nlp
 * path is used unchanged.
 *
 * Returns `null` if neither endpoint is configured for the resolved engine —
 * caller should warn-and-skip in that case.
 */
const resolveTopicClusteringEndpoint = async (
  projectId: string,
): Promise<{ baseUrl: string; engine: "langevals" | "langwatch_nlp" } | null> => {
  const goEnabled = await isNlpGoEnabled({ projectId });
  if (goEnabled) {
    if (!env.LANGEVALS_ENDPOINT) return null;
    return { baseUrl: env.LANGEVALS_ENDPOINT, engine: "langevals" };
  }
  if (!env.TOPIC_CLUSTERING_SERVICE) return null;
  return { baseUrl: env.TOPIC_CLUSTERING_SERVICE, engine: "langwatch_nlp" };
};

export const fetchTopicsBatchClustering = async (
  projectId: string,
  params: BatchClusteringParams,
): Promise<TopicClusteringResponse | undefined> => {
  const endpoint = await resolveTopicClusteringEndpoint(projectId);
  if (!endpoint) {
    logger.warn(
      { projectId },
      "Topic clustering service URL not set, skipping topic clustering",
    );
    return;
  }

  const size = JSON.stringify(params).length;
  getPayloadSizeHistogram("topic_clustering_batch").observe(size);

  logger.info(
    { sizeMb: size / 125000, projectId, engine: endpoint.engine },
    "uploading traces data for project",
  );

  const response = await postToTopicClustering({
    projectId,
    engine: endpoint.engine,
    url: `${endpoint.baseUrl}/topics/batch_clustering`,
    body: params,
    kind: "topic_clustering_batch",
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
    throw new Error(
      `Failed to fetch topics batch clustering (${endpoint.engine}): ${response.statusText}\n\n${body}`,
    );
  }

  const result = (await response.json()) as TopicClusteringResponse;

  return result;
};

export const fetchTopicsIncrementalClustering = async (
  projectId: string,
  params: IncrementalClusteringParams,
): Promise<TopicClusteringResponse | undefined> => {
  const endpoint = await resolveTopicClusteringEndpoint(projectId);
  if (!endpoint) {
    logger.warn(
      { projectId },
      "Topic clustering service URL not set, skipping topic clustering",
    );
    return;
  }

  const size = JSON.stringify(params).length;
  getPayloadSizeHistogram("topic_clustering_incremental").observe(size);

  logger.info(
    { sizeMb: size / 125000, projectId, engine: endpoint.engine },
    "uploading traces data for project",
  );

  const response = await postToTopicClustering({
    projectId,
    engine: endpoint.engine,
    url: `${endpoint.baseUrl}/topics/incremental_clustering`,
    body: params,
    kind: "topic_clustering_incremental",
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

    throw new Error(
      `Failed to fetch topics incremental clustering (${endpoint.engine}): ${response.statusText}\n\n${body}`,
    );
  }

  const result = (await response.json()) as TopicClusteringResponse;

  return result;
};

/**
 * The langwatch_nlp engine runs on a k8s pod behind an ingress that
 * historically accepts ~100 MB bodies — fetch-h2 (HTTP/2) is preserved
 * there to avoid regressing self-hosted operators with large batches.
 *
 * The langevals engine runs on AWS Lambda which hard-caps sync invokes
 * at 6 MB; we stage anything past LANGEVALS_STAGING_THRESHOLD_BYTES to
 * S3 and pass the presigned URL via X-Payload-S3-URL.
 */
const postToTopicClustering = async (opts: {
  projectId: string;
  engine: "langevals" | "langwatch_nlp";
  url: string;
  body: BatchClusteringParams | IncrementalClusteringParams;
  kind: "topic_clustering_batch" | "topic_clustering_incremental";
}) => {
  if (opts.engine === "langevals") {
    return stagedLangevalsFetch({
      url: opts.url,
      body: opts.body,
      projectId: opts.projectId,
      kind: opts.kind,
    });
  }
  return fetchHTTP2(opts.url, { method: "POST", json: opts.body });
};
