import type { Project } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { Worker } from "bullmq";
import type { CollectorJob } from "~/server/background/types";
import { env } from "../../../env.mjs";
import { getDebugger } from "../../../utils/logger";
import { prisma } from "../../db";
import { TRACE_INDEX, esClient, traceIndexId } from "../../elasticsearch";
import { connection } from "../../redis";
import {
  type ElasticSearchInputOutput,
  type ElasticSearchSpan,
  type ElasticSearchTrace,
  type ErrorCapture,
  type Span,
  type SpanInputOutput,
} from "../../tracer/types";
import { COLLECTOR_QUEUE, collectorQueue } from "../queues/collectorQueue";
import {
  addGuardrailCosts,
  addLLMTokensCount,
  computeTraceMetrics,
} from "./collector/metrics";
import { cleanupPIIs } from "./collector/piiCheck";
import { addInputAndOutputForRAGs } from "./collector/rag";
import { scoreSatisfactionFromInput } from "./collector/satisfaction";
import { getTraceInput, getTraceOutput } from "./collector/trace";
import { scheduleTraceChecks } from "./collector/traceChecks";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { mapEvaluations } from "./collector/evaluations";

const debug = getDebugger("langwatch:workers:collectorWorker");

export const scheduleTraceCollectionWithFallback = async (
  collectorJob: CollectorJob
) => {
  try {
    const timeoutState = { state: "waiting" };
    const timeoutPromise = new Promise((resolve, reject) => {
      setTimeout(() => {
        if (timeoutState.state === "waiting") {
          reject(new Error("Timed out after 3s trying to insert on the queue"));
        } else {
          resolve(undefined);
        }
      }, 3000);
    });

    await Promise.race([
      timeoutPromise,
      collectorQueue
        .add("collector", collectorJob, {
          jobId: `collector_${collectorJob.traceId}_md5:${collectorJob.paramsMD5}`,
        })
        .then(() => {
          timeoutState.state = "resolved";
        }),
    ]);
  } catch (error) {
    debug(
      "Failed sending to redis collector queue inserting trace directly, processing job synchronously.",
      "Exception:",
      error
    );
    Sentry.captureException(error, {
      extra: {
        message:
          "Failed sending to redis collector queue inserting trace directly, processing job synchronously",
        projectId: collectorJob.projectId,
      },
    });

    await processCollectorJob(undefined, collectorJob);
  }
};

export const processCollectorJob = async (
  id: string | undefined,
  data: CollectorJob
) => {
  debug(`Processing job ${id} with data:`, JSON.stringify(data, null, 2));

  let spans = data.spans;
  const {
    projectId,
    traceId,
    reservedTraceMetadata,
    customMetadata,
    expectedOutput,
    existingTrace,
    paramsMD5,
  } = data;
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
  });

  spans = addInputAndOutputForRAGs(
    await addLLMTokensCount(projectId, addGuardrailCosts(spans))
  );

  const esSpans: ElasticSearchSpan[] = spans.map((span) => ({
    ...span,
    input: span.input ? typedValueToElasticSearch(span.input) : null,
    output: span.output ? typedValueToElasticSearch(span.output) : null,
    project_id: project.id,
    timestamps: {
      ...span.timestamps,
      inserted_at: Date.now(),
      updated_at: Date.now(),
    },
  }));

  const [input, output] = await Promise.all([
    getTraceInput(spans),
    getTraceOutput(spans),
  ]);
  const error = getLastOutputError(spans);

  const evaluations = mapEvaluations(data);

  // Create the trace
  const trace: ElasticSearchTrace = {
    trace_id: traceId,
    project_id: project.id,
    metadata: {
      ...reservedTraceMetadata,
      ...(Object.keys(customMetadata).length > 0
        ? { custom: customMetadata }
        : {}),
      all_keys: [
        ...(existingTrace?.all_keys ?? []),
        ...Object.keys(reservedTraceMetadata),
        ...Object.keys(customMetadata),
      ],
    },
    timestamps: {
      ...(!existingTrace
        ? {
            started_at:
              Math.min(...spans.map((span) => span.timestamps.started_at)) ??
              Date.now(),
            inserted_at: Date.now(),
          }
        : {}),
      updated_at: Date.now(),
    } as ElasticSearchTrace["timestamps"],
    ...(input?.value ? { input } : {}),
    ...(output?.value ? { output } : {}),
    ...(expectedOutput ? { expected_output: { value: expectedOutput } } : {}),
    metrics: computeTraceMetrics(spans),
    error,
    indexing_md5s: [...(existingTrace?.indexing_md5s ?? []), paramsMD5],
  };

  const piiEnforced = env.NODE_ENV === "production";
  await cleanupPIIs(trace, esSpans, project.piiRedactionLevel, piiEnforced);

  await esClient.update({
    index: TRACE_INDEX.alias,
    id: traceIndexId({ traceId, projectId: project.id }),
    retry_on_conflict: 5,
    body: {
      doc: trace,
      doc_as_upsert: true,
    },
  });

  await esClient.update({
    index: TRACE_INDEX.alias,
    id: traceIndexId({ traceId, projectId: project.id }),
    retry_on_conflict: 5,
    body: {
      script: {
        source: `
          if (ctx._source.spans == null) {
            ctx._source.spans = [];
          }
          def currentTime = System.currentTimeMillis();
          for (def newSpan : params.newSpans) {
            def existingSpanIndex = -1;
            for (int i = 0; i < ctx._source.spans.size(); i++) {
              if (ctx._source.spans[i].span_id == newSpan.span_id) {
                existingSpanIndex = i;
                break;
              }
            }
            if (existingSpanIndex >= 0) {
              if (newSpan.timestamps == null) {
                newSpan.timestamps = new HashMap();
                newSpan.timestamps.inserted_at = currentTime;
              }
              newSpan.timestamps.updated_at = currentTime;
              ctx._source.spans[existingSpanIndex] = newSpan;
            } else {
              ctx._source.spans.add(newSpan);
            }
          }
        `,
        lang: "painless",
        params: {
          newSpans: esSpans,
        },
      },
      upsert: {
        ...trace,
        spans: esSpans,
      },
    },
    refresh: true,
  });

  if (evaluations) {
    await esClient.update({
      index: TRACE_INDEX.alias,
      id: traceIndexId({ traceId, projectId: project.id }),
      retry_on_conflict: 5,
      body: {
        script: {
          source: `
            if (ctx._source.evaluations == null) {
              ctx._source.evaluations = [];
            }
            def currentTime = System.currentTimeMillis();
            for (def newEvaluation : params.newEvaluations) {
              def existingEvaluationIndex = -1;
              for (int i = 0; i < ctx._source.evaluations.size(); i++) {
                if (ctx._source.evaluations[i].check_id == newEvaluation.check_id) {
                  existingEvaluationIndex = i;
                  break;
                }
              }
              if (existingEvaluationIndex >= 0) {
                if (newEvaluation.timestamps == null) {
                  newEvaluation.timestamps = new HashMap();
                  newEvaluation.timestamps.inserted_at = currentTime;
                }
                newEvaluation.timestamps.updated_at = currentTime;
                ctx._source.evaluations[existingEvaluationIndex] = newEvaluation;
              } else {
                ctx._source.evaluations.add(newEvaluation);
              }
            }
          `,
          lang: "painless",
          params: {
            newEvaluations: evaluations,
          },
        },
        upsert: {
          ...trace,
          evaluations,
        },
      },
      refresh: true,
    });
  }

  // Does not re-schedule trace checks for too old traces being resynced
  if (
    !existingTrace?.inserted_at ||
    existingTrace.inserted_at > Date.now() - 30 * 1000
  ) {
    void scheduleTraceChecks(trace, spans);
  }

  void markProjectFirstMessage(project);

  try {
    void scoreSatisfactionFromInput({
      traceId: trace.trace_id,
      projectId: trace.project_id,
      input: trace.input,
    });
  } catch {
    debug("Failed to score satisfaction for", trace.trace_id);
  }
};

export const startCollectorWorker = () => {
  const collectorWorker = new Worker<CollectorJob, void, string>(
    COLLECTOR_QUEUE,
    (job) => processCollectorJob(job.id, job.data),
    {
      connection,
      concurrency: 20,
    }
  );

  collectorWorker.on("ready", () => {
    debug("Collector worker active, waiting for jobs!");
  });

  collectorWorker.on("failed", (job, err) => {
    debug(`Job ${job?.id} failed with error ${err.message}`);
    Sentry.withScope((scope) => {
      scope.setTag("worker", "collector");
      scope.setExtra("job", job?.data);
      Sentry.captureException(err);
    });
  });

  debug("Collector worker registered");
  return collectorWorker;
};

const typedValueToElasticSearch = (
  typed: SpanInputOutput
): ElasticSearchInputOutput => {
  return {
    type: typed.type,
    value: JSON.stringify(typed.value),
  };
};

// TODO: test, move to common, and fix this sorting on the TODO right below
const getLastOutputError = (spans: Span[]): ErrorCapture | null => {
  // TODO: shouldn't it be sorted by parent-child?
  const errorSpans = spans.filter((span) => span.error);
  const lastError = errorSpans[errorSpans.length - 1];
  if (!lastError) {
    return null;
  }
  return lastError.error ?? null;
};

const markProjectFirstMessage = async (project: Project) => {
  if (!project.firstMessage) {
    await prisma.project.update({
      where: { id: project.id },
      data: { firstMessage: true },
    });
  }
};

export const fetchExistingMD5s = async (
  traceId: string,
  projectId: string
): Promise<
  | {
      indexing_md5s: ElasticSearchTrace["indexing_md5s"];
      inserted_at: number | undefined;
      all_keys: string[] | undefined;
    }
  | undefined
> => {
  const existingTraceResponse = await esClient.search<ElasticSearchTrace>({
    index: TRACE_INDEX.alias,
    body: {
      size: 1,
      query: {
        bool: {
          must: [
            { term: { trace_id: traceId } },
            { term: { project_id: projectId } },
          ] as QueryDslBoolQuery["must"],
        } as QueryDslBoolQuery,
      },
      _source: ["indexing_md5s", "timestamps.inserted_at", "metadata.all_keys"],
    },
  });

  const existingTrace = existingTraceResponse.hits.hits[0]?._source;
  if (!existingTrace) {
    return undefined;
  }

  return {
    indexing_md5s: existingTrace.indexing_md5s,
    inserted_at: existingTrace.timestamps?.inserted_at,
    all_keys: existingTrace.metadata?.all_keys,
  };
};
