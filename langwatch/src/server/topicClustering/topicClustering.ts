import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import { CostReferenceType, CostType, type Project } from "@prisma/client";
import { fetch as fetchHTTP2 } from "fetch-h2";
import { nanoid } from "nanoid";
import { env } from "../../env.mjs";
import { createLogger } from "../../utils/logger.server";
import { scheduleTopicClusteringNextPage } from "../background/queues/topicClusteringQueue";
import { prisma } from "../db";
import { TRACE_INDEX, esClient, traceIndexId } from "../elasticsearch";
import { getProjectEmbeddingsModel } from "../embeddings";
import type { ElasticSearchTrace, Trace } from "../tracer/types";
import {
  type BatchClusteringParams,
  type IncrementalClusteringParams,
  type TopicClusteringResponse,
  type TopicClusteringSubtopic,
  type TopicClusteringTopic,
  type TopicClusteringTrace,
  type TopicClusteringTraceTopicMap,
} from "./types";
import {
  getCurrentMonthCost,
  maxMonthlyUsageLimit,
} from "../api/routers/limits";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../api/routers/modelProviders";
import { getPayloadSizeHistogram } from "../metrics";
import {
  DEFAULT_TOPIC_CLUSTERING_MODEL,
  OPENAI_EMBEDDING_DIMENSION,
} from "../../utils/constants";

const logger = createLogger("langwatch:topicClustering");

export const clusterTopicsForProject = async (
  projectId: string,
  searchAfter?: [number, string],
  scheduleNextPage = true
): Promise<void> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: true },
  });
  if (!project) {
    throw new Error("Project not found");
  }
  const maxMonthlyUsage = await maxMonthlyUsageLimit(
    project.team.organizationId
  );
  const getCurrentCost = await getCurrentMonthCost(project.team.organizationId);
  if (getCurrentCost >= maxMonthlyUsage) {
    logger.info(
      { projectId },
      "skipping clustering for project as monthly limit has been reached"
    );
  }

  const client = await esClient({ projectId });
  const assignedTracesCount = await client.count({
    index: TRACE_INDEX.alias,
    body: {
      query: {
        bool: {
          must: [
            {
              term: {
                project_id: projectId,
              },
            },
            {
              exists: {
                field: "metadata.topic_id",
              },
            },
          ],
        } as QueryDslBoolQuery,
      },
    },
  });

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
    topicIds.length > 0 && assignedTracesCount.count >= 1200;

  const lastTopicCreatedAt = topics.reduce((acc, topic) => {
    return topic.createdAt > acc ? topic.createdAt : acc;
  }, new Date(0));

  const daysFrequency =
    assignedTracesCount.count < 100
      ? 7
      : assignedTracesCount.count < 500
      ? 3
      : 2;
  if (
    !isIncrementalProcessing &&
    lastTopicCreatedAt >
      new Date(Date.now() - daysFrequency * 24 * 60 * 60 * 1000)
  ) {
    logger.info(
      { projectId },
      `skipping clustering for project as last topic from batch processing was created less than ${daysFrequency} days ago`
    );
    return;
  }

  let presenceCondition: QueryDslQueryContainer[] = [
    {
      range: {
        "timestamps.started_at": {
          gte: "now-12M", // Limit to last 12 months for full batch processing
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
            gte: "now-12M", // grab only messages that were not classified in last 3 months for incremental processing
            lt: "now",
          },
        },
      },
      {
        // Must either not have any of the available topics, or available subtopics
        bool: {
          should: [
            {
              bool: {
                must_not: topicIds.map((topicId) => ({
                  term: {
                    "metadata.topic_id": topicId,
                  },
                })) as QueryDslQueryContainer[],
              } as QueryDslBoolQuery,
            },
            {
              bool: {
                must_not: subtopicIds.map((subtopicId) => ({
                  term: {
                    "metadata.subtopic_id": subtopicId,
                  },
                })) as QueryDslQueryContainer[],
              } as QueryDslBoolQuery,
            },
          ],
          minimum_should_match: 1,
        },
      },
    ];
  }

  // Fetch last 2000 traces that were not classified in sorted and paginated, with only id, input fields and their current topics

  const result = await client.search<Trace>({
    index: TRACE_INDEX.alias,
    body: {
      query: {
        bool: {
          must: [
            {
              term: { project_id: projectId },
            },
            ...presenceCondition,
          ],
        } as QueryDslBoolQuery,
      },
      _source: [
        "trace_id",
        "input",
        "metadata.topic_id",
        "metadata.subtopic_id",
      ],
      sort: [{ "timestamps.started_at": "desc" }, { trace_id: "asc" }],
      ...(searchAfter ? { search_after: searchAfter } : {}),
      size: 2000,
    },
  });

  const traces: TopicClusteringTrace[] = result.hits.hits
    .map((hit) => hit._source!)
    .filter((trace) => !!trace?.input?.value)
    .map((trace) => ({
      trace_id: trace.trace_id,
      input: trace.input?.value.slice(0, 8192) ?? "",
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

  const minimumTraces = isIncrementalProcessing ? 1 : 10;

  if (traces.length < minimumTraces) {
    logger.info(
      { projectId },
      `less than ${minimumTraces} traces found for project, skipping topic clustering`
    );
    return;
  }

  if (isIncrementalProcessing) {
    await incrementalClustering(project, traces);
  } else {
    await batchClusterTraces(project, traces);
  }

  // If results are not close to empty, schedule the seek for next page
  if (result.hits.hits.length > 10) {
    const lastTraceSort = result.hits.hits.reverse()[0]?.sort as
      | [number, string]
      | undefined;
    if (lastTraceSort) {
      logger.info(
        { projectId, lastTraceSort },
        "scheduling the next page for clustering"
      );
      if (scheduleNextPage) {
        await scheduleTopicClusteringNextPage(projectId, lastTraceSort);
      } else {
        logger.info(
          { projectId, lastTraceSort },
          "skipping scheduling next page for project"
        );
      }
    }
  }

  logger.info({ projectId }, "done! project");
};

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
      "topic cluste ring model provider is not enabled, skipping topic clustering"
    );
    return;
  }

  return { model: topicClusteringModel, modelProvider };
};

export const batchClusterTraces = async (
  project: Project,
  traces: TopicClusteringTrace[]
) => {
  logger.info(
    { tracesLength: traces.length, projectId: project.id },
    "batch clustering topics"
  );

  const topicModel = await getProjectTopicClusteringModelProvider(project);
  if (!topicModel) {
    return;
  }
  const embeddingsModel = await getProjectEmbeddingsModel(project.id);
  const clusteringResult = await fetchTopicsBatchClustering(project.id, {
    litellm_params: prepareLitellmParams(
      topicModel.model,
      topicModel.modelProvider
    ),
    embeddings_litellm_params: {
      ...prepareLitellmParams(
        embeddingsModel.model,
        embeddingsModel.modelProvider
      ),
      dimensions: OPENAI_EMBEDDING_DIMENSION,
    },
    traces,
  });

  await storeResults(project.id, clusteringResult, false);
};

export const incrementalClustering = async (
  project: Project,
  traces: TopicClusteringTrace[]
) => {
  logger.info(
    { tracesLength: traces.length, projectId: project.id },
    "incremental topic clustering"
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
    litellm_params: prepareLitellmParams(
      topicModel.model,
      topicModel.modelProvider
    ),
    embeddings_litellm_params: {
      ...prepareLitellmParams(
        embeddingsModel.model,
        embeddingsModel.modelProvider
      ),
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
  isIncremental: boolean
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
    "found new topics, subtopics and traces to assign for project"
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
  params: BatchClusteringParams
): Promise<TopicClusteringResponse | undefined> => {
  if (!env.TOPIC_CLUSTERING_SERVICE) {
    console.warn(
      "Topic clustering service URL not set, skipping topic clustering"
    );
    return;
  }

  const size = JSON.stringify(params).length;
  getPayloadSizeHistogram("topic_clustering_batch").observe(size);

  logger.info(
    { sizeMb: size / 125000, projectId },
    "uploading traces data for project"
  );

  const response = await fetchHTTP2(
    `${env.TOPIC_CLUSTERING_SERVICE}/topics/batch_clustering`,
    { method: "POST", json: params }
  );

  if (!response.ok) {
    let body = await response.text();
    try {
      body = JSON.stringify(JSON.parse(body), null, 2)
        .split("\n")
        .slice(0, 10)
        .join("\n");
    } catch { }
    throw new Error(
      `Failed to fetch topics batch clustering: ${response.statusText}\n\n${body}`
    );
  }

  const result = (await response.json()) as TopicClusteringResponse;

  return result;
};

export const fetchTopicsIncrementalClustering = async (
  projectId: string,
  params: IncrementalClusteringParams
): Promise<TopicClusteringResponse | undefined> => {
  if (!env.TOPIC_CLUSTERING_SERVICE) {
    console.warn(
      "Topic clustering service URL not set, skipping topic clustering"
    );
    return;
  }

  const size = JSON.stringify(params).length;
  getPayloadSizeHistogram("topic_clustering_incremental").observe(size);

  logger.info(
    { sizeMb: size / 125000, projectId },
    "uploading traces data for project"
  );

  const response = await fetchHTTP2(
    `${env.TOPIC_CLUSTERING_SERVICE}/topics/incremental_clustering`,
    { method: "POST", json: params }
  );

  if (!response.ok) {
    let body = await response.text();
    try {
      body = JSON.stringify(JSON.parse(body), null, 2)
        .split("\n")
        .slice(0, 10)
        .join("\n");
    } catch {}
    throw new Error(
      `Failed to fetch topics incremental clustering: ${response.statusText}\n\n${body}`
    );
  }

  const result = (await response.json()) as TopicClusteringResponse;

  return result;
};
