import type { ClickHouseClient } from "@clickhouse/client";
import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import { CostReferenceType, CostType, type Project } from "@prisma/client";
import { fetch as fetchHTTP2 } from "fetch-h2";
import { nanoid } from "nanoid";
import { env } from "../../env.mjs";
import {
  DEFAULT_TOPIC_CLUSTERING_MODEL,
  OPENAI_EMBEDDING_DIMENSION,
} from "../../utils/constants";
import { createLogger } from "../../utils/logger/server";
import { getExtractedInput } from "../../utils/traceExtraction";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../api/routers/modelProviders";
import { getApp } from "../app-layer/app";
import { scheduleTopicClusteringNextPage } from "../background/queues/topicClusteringQueue";
import { getClickHouseClient } from "../clickhouse/client";
import { prisma } from "../db";
import { esClient, TRACE_INDEX, traceIndexId } from "../elasticsearch";
import { getProjectEmbeddingsModel } from "../embeddings";
import { createCostChecker } from "../license-enforcement/license-enforcement.repository";
import { getPayloadSizeHistogram } from "../metrics";
import type { ElasticSearchTrace, Trace } from "../tracer/types";
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
    include: { team: true },
  });
  if (!project) {
    throw new Error("Project not found");
  }
  const costChecker = createCostChecker(prisma);
  const maxMonthlyUsage = await costChecker.maxMonthlyUsageLimit(
    project.team.organizationId,
  );
  const getCurrentCost = await costChecker.getCurrentMonthCost(
    project.team.organizationId,
  );
  if (getCurrentCost >= maxMonthlyUsage) {
    logger.info(
      { projectId },
      "skipping clustering for project as monthly limit has been reached",
    );
  }

  const clickhouse = project.featureClickHouseDataSourceTraces
    ? getClickHouseClient()
    : null;

  const { totalTracesCount, tracesWithInputCount, recentTracesCount, assignedTracesCount } =
    clickhouse
      ? await fetchCountsFromClickHouse(clickhouse, projectId)
      : await fetchCountsFromElasticsearch(projectId);

  logger.info(
    {
      projectId,
      totalTraces: totalTracesCount,
      tracesWithInput: tracesWithInputCount,
      recentTraces: recentTracesCount,
      backend: clickhouse ? "clickhouse" : "elasticsearch",
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

  const { traces, lastSort, returnedCount } = clickhouse
    ? await fetchTracesFromClickHouse(
        clickhouse,
        projectId,
        isIncrementalProcessing,
        topicIds,
        subtopicIds,
        searchAfter,
      )
    : await fetchTracesFromElasticsearch(
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
        toString(count(DISTINCT TraceId)) AS total,
        toString(countDistinctIf(TraceId, length(ComputedInput) > 0)) AS withInput,
        toString(countDistinctIf(TraceId, OccurredAt >= fromUnixTimestamp64Milli({thirtyDaysAgo:UInt64}))) AS recent,
        toString(countDistinctIf(TraceId, TopicId IS NOT NULL AND TopicId != '')) AS assigned
      FROM trace_summaries
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64})
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

async function fetchCountsFromElasticsearch(
  projectId: string,
): Promise<TraceCounts> {
  const client = await esClient({ projectId });

  const [totalTracesCount, tracesWithInputCount, recentTracesCount, assignedTracesCount] =
    await Promise.all([
      client.count({
        index: TRACE_INDEX.alias,
        body: { query: { term: { project_id: projectId } } },
      }),
      client.count({
        index: TRACE_INDEX.alias,
        body: {
          query: {
            bool: {
              must: [
                { term: { project_id: projectId } },
                { exists: { field: "input.value" } },
              ],
            } as QueryDslBoolQuery,
          },
        },
      }),
      client.count({
        index: TRACE_INDEX.alias,
        body: {
          query: {
            bool: {
              must: [
                { term: { project_id: projectId } },
                { range: { "timestamps.started_at": { gte: "now-30d" } } },
              ],
            } as QueryDslBoolQuery,
          },
        },
      }),
      client.count({
        index: TRACE_INDEX.alias,
        body: {
          query: {
            bool: {
              must: [
                { term: { project_id: projectId } },
                { exists: { field: "metadata.topic_id" } },
              ],
            } as QueryDslBoolQuery,
          },
        },
      }),
    ]);

  return {
    totalTracesCount: totalTracesCount.count,
    tracesWithInputCount: tracesWithInputCount.count,
    recentTracesCount: recentTracesCount.count,
    assignedTracesCount: assignedTracesCount.count,
  };
}

async function fetchTracesFromClickHouse(
  clickhouse: ClickHouseClient,
  projectId: string,
  isIncrementalProcessing: boolean,
  topicIds: string[],
  subtopicIds: string[],
  searchAfter?: [number, string],
): Promise<TraceSearchResult> {
  const twelveMonthsAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;

  const conditions = [
    "TenantId = {tenantId:String}",
    "OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64})",
    "OccurredAt < now64(3)",
    "ComputedInput IS NOT NULL",
    "ComputedInput != ''",
  ];

  if (isIncrementalProcessing && (topicIds.length > 0 || subtopicIds.length > 0)) {
    // Must either not have any of the known topics, or not have any of the known subtopics
    const topicCondition =
      topicIds.length > 0
        ? `(TopicId IS NULL OR TopicId NOT IN ({topicIds:Array(String)}))`
        : "1=1";
    const subtopicCondition =
      subtopicIds.length > 0
        ? `(SubTopicId IS NULL OR SubTopicId NOT IN ({subtopicIds:Array(String)}))`
        : "1=1";
    conditions.push(`(${topicCondition} OR ${subtopicCondition})`);
  }

  if (searchAfter) {
    conditions.push(
      "(toUnixTimestamp64Milli(OccurredAt), TraceId) < ({lastTs:UInt64}, {lastTraceId:String})",
    );
  }

  const whereClause = conditions.join(" AND ");

  const result = await clickhouse.query({
    query: `
      SELECT
        TraceId,
        ComputedInput,
        TopicId,
        SubTopicId,
        toString(toUnixTimestamp64Milli(OccurredAt)) AS OccurredAtMs
      FROM (
        SELECT *
        FROM trace_summaries
        WHERE ${whereClause}
        ORDER BY TraceId, LastUpdatedAt DESC
        LIMIT 1 BY TraceId
      )
      ORDER BY OccurredAt DESC, TraceId ASC
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

async function fetchTracesFromElasticsearch(
  projectId: string,
  isIncrementalProcessing: boolean,
  topicIds: string[],
  subtopicIds: string[],
  searchAfter?: [number, string],
): Promise<TraceSearchResult> {
  const client = await esClient({ projectId });

  let presenceCondition: QueryDslQueryContainer[] = [
    {
      range: {
        "timestamps.started_at": {
          gte: "now-12M",
          lt: "now",
        },
      },
    },
  ];
  if (isIncrementalProcessing) {
    presenceCondition = [
      {
        range: {
          "timestamps.started_at": {
            gte: "now-12M",
            lt: "now",
          },
        },
      },
      {
        bool: {
          should: [
            {
              bool: {
                must_not: topicIds.map((topicId) => ({
                  term: { "metadata.topic_id": topicId },
                })) as QueryDslQueryContainer[],
              } as QueryDslBoolQuery,
            },
            {
              bool: {
                must_not: subtopicIds.map((subtopicId) => ({
                  term: { "metadata.subtopic_id": subtopicId },
                })) as QueryDslQueryContainer[],
              } as QueryDslBoolQuery,
            },
          ],
          minimum_should_match: 1,
        },
      },
    ];
  }

  const result = await client.search<Trace>({
    index: TRACE_INDEX.alias,
    body: {
      query: {
        bool: {
          must: [
            { term: { project_id: projectId } },
            ...presenceCondition,
          ],
        } as QueryDslBoolQuery,
      },
      _source: [
        "trace_id",
        "input",
        "metadata.topic_id",
        "metadata.subtopic_id",
        "timestamps.started_at",
      ],
      sort: [{ "timestamps.started_at": "desc" }, { trace_id: "asc" }],
      ...(searchAfter ? { search_after: searchAfter } : {}),
      size: 2000,
    },
  });

  logger.info(
    {
      projectId,
      totalHits: result.hits.total,
      returnedHits: result.hits.hits.length,
    },
    "Elasticsearch search results",
  );

  const rawTraces = result.hits.hits.map((hit) => hit._source!);

  const traces: TopicClusteringTrace[] = rawTraces
    .filter((trace) => {
      const inputText = getExtractedInput(trace);
      return inputText !== "<empty>" && inputText.length > 0;
    })
    .map((trace) => ({
      trace_id: trace.trace_id,
      input: getExtractedInput(trace).slice(0, 8192),
      topic_id:
        trace.metadata?.topic_id && topicIds.includes(trace.metadata.topic_id)
          ? trace.metadata.topic_id
          : null,
      subtopic_id:
        trace.metadata?.subtopic_id &&
        subtopicIds.includes(trace.metadata.subtopic_id)
          ? trace.metadata.subtopic_id
          : null,
    }));

  const lastTraceSort = result.hits.hits.toReversed()[0]?.sort as
    | [number, string]
    | undefined;

  return {
    traces,
    lastSort: lastTraceSort,
    returnedCount: result.hits.hits.length,
  };
}

const getProjectTopicClusteringModelProvider = async (project: Project) => {
  const topicClusteringModel =
    project.topicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL;
  if (!topicClusteringModel) {
    throw new Error("Topic clustering model not set");
  }
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

  const body = tracesToAssign.flatMap(({ trace_id, topic_id, subtopic_id }) => [
    { update: { _id: traceIndexId({ traceId: trace_id, projectId }) } },
    {
      doc: {
        metadata: { topic_id, subtopic_id },
        timestamps: { updated_at: Date.now() },
      } as Partial<ElasticSearchTrace>,
    },
  ]);

  if (body.length > 0) {
    const client = await esClient({ projectId });
    await client.bulk({
      index: TRACE_INDEX.alias,
      refresh: true,
      body,
    });
  }

  // Emit TopicAssignedEvents via command queue (only for ES-enabled projects)
  if (tracesToAssign.length > 0) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { featureEventSourcingTraceIngestion: true },
      });

      if (!project?.featureEventSourcingTraceIngestion) {
        logger.debug(
          { projectId },
          "Skipping AssignTopic commands - event sourcing not enabled for project",
        );
      } else {
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
      }
    } catch (error) {
      logger.error({ projectId, error }, "Failed to send AssignTopic commands");
      // Don't fail the job - ES update already succeeded
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

export const fetchTopicsBatchClustering = async (
  projectId: string,
  params: BatchClusteringParams,
): Promise<TopicClusteringResponse | undefined> => {
  if (!env.TOPIC_CLUSTERING_SERVICE) {
    logger.warn(
      { projectId },
      "Topic clustering service URL not set, skipping topic clustering",
    );
    return;
  }

  const size = JSON.stringify(params).length;
  getPayloadSizeHistogram("topic_clustering_batch").observe(size);

  logger.info(
    { sizeMb: size / 125000, projectId },
    "uploading traces data for project",
  );

  const response = await fetchHTTP2(
    `${env.TOPIC_CLUSTERING_SERVICE}/topics/batch_clustering`,
    { method: "POST", json: params },
  );

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
      `Failed to fetch topics batch clustering: ${response.statusText}\n\n${body}`,
    );
  }

  const result = (await response.json()) as TopicClusteringResponse;

  return result;
};

export const fetchTopicsIncrementalClustering = async (
  projectId: string,
  params: IncrementalClusteringParams,
): Promise<TopicClusteringResponse | undefined> => {
  if (!env.TOPIC_CLUSTERING_SERVICE) {
    logger.warn(
      { projectId },
      "Topic clustering service URL not set, skipping topic clustering",
    );
    return;
  }

  const size = JSON.stringify(params).length;
  getPayloadSizeHistogram("topic_clustering_incremental").observe(size);

  logger.info(
    { sizeMb: size / 125000, projectId },
    "uploading traces data for project",
  );

  const response = await fetchHTTP2(
    `${env.TOPIC_CLUSTERING_SERVICE}/topics/incremental_clustering`,
    { method: "POST", json: params },
  );

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
      `Failed to fetch topics incremental clustering: ${response.statusText}\n\n${body}`,
    );
  }

  const result = (await response.json()) as TopicClusteringResponse;

  return result;
};
