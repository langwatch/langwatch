import {
  type EvaluationApi,
  LangevalsClusteringError,
  type TopicClusteringRequest,
} from "@langwatch/evaluation-contract";
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
import type { TraceApi } from "@langwatch/trace-contract";

import type { TopicClusteringCommands } from "../app/topic.members.ts";
import type { TopicClusteringRepository } from "../repositories/topic-clustering.repository.ts";
import {
  TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS,
  type TopicClusteringPageOutcome,
  type TopicClusteringRun,
} from "./topic-clustering.intent.ts";

const logger = createLogger("langwatch:topicClustering");

/** The embeddings dimension the clustering params pin (text-embedding-3-small). */
const OPENAI_EMBEDDING_DIMENSION = 1536;

// Hard deadline on langevals call derived from outbox lease to prevent concurrent runs
// destroying the model in batch mode; 60% of lease leaves room for response + store + outcome.
export const TOPIC_CLUSTERING_REQUEST_DEADLINE_MS = Math.floor(
  TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS * 0.6,
);

const PAYLOAD_KIND = {
  batch: "topic_clustering_batch",
  incremental: "topic_clustering_incremental",
} as const;

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

/** What a clustering call answered: its result, or that no clustering service is configured. */
export type TopicClusteringFetch =
  | { kind: "clustered"; response: TopicClusteringResponse }
  | { kind: "not_configured" };

export type ClusteringRunOutcome =
  | { kind: "stored"; summary: ClusteringStoreSummary }
  | { kind: "not_configured" };

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
  /** Trace owns the summaries clustering reads and the topic it assigns (ARCHITECTURE §3.3). */
  traces: Pick<TraceApi, "readTopicClusteringCounts" | "readTopicClusteringPage" | "assignTopic">;
  models: TopicClusteringModels;
  /** `not_configured` when the deployment names no langevals endpoint; evaluation logs it. */
  evaluations: Pick<EvaluationApi, "requestTopicClustering">;
  repository: TopicClusteringRepository;
  /** The legacy import, for the write-path topic-model seed guard. */
  migration: TopicClusteringWritePathSeed;
  commands: TopicClusteringCommands;
  /** Payload-size histogram observation per langevals call kind. */
  observePayloadSize: (
    kind: (typeof PAYLOAD_KIND)[keyof typeof PAYLOAD_KIND],
    sizeBytes: number,
  ) => void;
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

  const { totalTracesCount, recentTracesCount, assignedTracesCount } =
    await deps.traces.readTopicClusteringCounts({ projectId });

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

  const { traces, lastSort, returnedCount } = await deps.traces.readTopicClusteringPage({
    projectId,
    isIncrementalProcessing,
    topicIds,
    subtopicIds,
    ...(searchAfter ? { searchAfter } : {}),
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

  const outcome = isIncrementalProcessing
    ? await incrementalClustering({ deps, projectId, traces, runContext })
    : await batchClusterTraces({ deps, projectId, traces, runContext });

  logger.info({ projectId }, "done! project");

  if (outcome.kind === "not_configured") {
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
    topicsCount: outcome.summary.topicsCount,
    subtopicsCount: outcome.summary.subtopicsCount,
    ...(nextSearchAfter ? { nextSearchAfter } : {}),
  };
};

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
}): Promise<ClusteringRunOutcome> => {
  logger.info({ tracesLength: traces.length, projectId }, "batch clustering topics");

  const topicModel = await getProjectTopicClusteringModelProvider(deps, projectId);
  if (!topicModel) {
    return { kind: "not_configured" };
  }
  const embeddingsModel = await deps.models.resolveEmbeddingsModel(projectId);
  const fetched = await fetchTopicsBatchClustering(deps, projectId, {
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

  if (fetched.kind === "not_configured") {
    return fetched;
  }

  return {
    kind: "stored",
    summary: await storeResults({
      deps,
      projectId,
      clusteringResult: fetched.response,
      isIncremental: false,
      runContext,
    }),
  };
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
}): Promise<ClusteringRunOutcome> => {
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
    return { kind: "not_configured" };
  }
  const embeddingsModel = await deps.models.resolveEmbeddingsModel(projectId);
  const fetched = await fetchTopicsIncrementalClustering(deps, projectId, {
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

  if (fetched.kind === "not_configured") {
    return fetched;
  }

  return {
    kind: "stored",
    summary: await storeResults({
      deps,
      projectId,
      clusteringResult: fetched.response,
      isIncremental: true,
      runContext,
    }),
  };
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
  clusteringResult: TopicClusteringResponse;
  isIncremental: boolean;
  runContext?: ClusteringRunContext;
}): Promise<ClusteringStoreSummary> => {
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
          deps.traces.assignTopic({
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

export const fetchTopicsBatchClustering = (
  deps: TopicClusteringRunnerDeps,
  projectId: string,
  params: BatchClusteringParams,
): Promise<TopicClusteringFetch> => requestClustering(deps, { projectId, mode: "batch", params });

export const fetchTopicsIncrementalClustering = (
  deps: TopicClusteringRunnerDeps,
  projectId: string,
  params: IncrementalClusteringParams,
): Promise<TopicClusteringFetch> =>
  requestClustering(deps, { projectId, mode: "incremental", params });

type ClusteringCall = TopicClusteringRequest extends infer R
  ? R extends TopicClusteringRequest
    ? Omit<R, "signal">
    : never
  : never;

/** The whole exchange, staging upload and body read included, lives inside the deadline. */
const requestClustering = async (
  deps: TopicClusteringRunnerDeps,
  call: ClusteringCall,
): Promise<TopicClusteringFetch> => {
  const kind = PAYLOAD_KIND[call.mode];
  const size = JSON.stringify(call.params).length;
  deps.observePayloadSize(kind, size);

  logger.info(
    { sizeMb: size / 125000, projectId: call.projectId, engine: "langevals" },
    "uploading traces data for project",
  );

  // An explicit controller (not AbortSignal.timeout()) so tests can advance
  // the timer; see TOPIC_CLUSTERING_REQUEST_DEADLINE_MS for why it exists.
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    controller.abort();
  }, TOPIC_CLUSTERING_REQUEST_DEADLINE_MS);
  deadline.unref?.();

  try {
    return await deps.evaluations.requestTopicClustering({
      ...call,
      signal: controller.signal,
    });
  } catch (error) {
    // Ours by default: the body often quotes an upstream provider error, but
    // quoting is not evidence, so the customer is told the code only.
    if (error instanceof LangevalsClusteringError) {
      throw new ClusteringError(CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE, error.message, {
        cause: error,
      });
    }
    if (controller.signal.aborted) {
      logger.warn(
        { projectId: call.projectId, kind, deadlineMs: TOPIC_CLUSTERING_REQUEST_DEADLINE_MS },
        "Topic clustering request aborted at its deadline; failing the page so the outbox retries inside the lease",
      );
      throw new ClusteringError(
        CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
        `Topic clustering request to langevals exceeded its ${TOPIC_CLUSTERING_REQUEST_DEADLINE_MS}ms deadline (${kind})`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(deadline);
  }
};
