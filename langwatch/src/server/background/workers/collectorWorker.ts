import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import type { Project } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { Worker } from "bullmq";
import type {
  CollectorCheckAndAdjustJob,
  CollectorJob,
} from "~/server/background/types";
import { env } from "../../../env.mjs";
import { getDebugger } from "../../../utils/logger";
import { flattenObjectKeys } from "../../api/utils";
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
import { elasticSearchSpanToSpan } from "../../tracer/utils";
import { COLLECTOR_QUEUE, collectorQueue } from "../queues/collectorQueue";
import { mapEvaluations, scheduleEvaluations } from "./collector/evaluations";
import {
  addGuardrailCosts,
  addLLMTokensCount,
  computeTraceMetrics,
} from "./collector/metrics";
import { cleanupPIIs } from "./collector/piiCheck";
import { addInputAndOutputForRAGs } from "./collector/rag";
import { scoreSatisfactionFromInput } from "./collector/satisfaction";
import { getTraceInput, getTraceOutput } from "./collector/trace";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";

const debug = getDebugger("langwatch:workers:collectorWorker");

export const scheduleTraceCollectionWithFallback = async (
  collectorJob: CollectorJob,
  forceSync = false
) => {
  if (forceSync || !collectorQueue) {
    debug("Force sync enabled, processing job synchronously.");
    await processCollectorJob(undefined, collectorJob);
    return;
  }

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
  data: CollectorJob | CollectorCheckAndAdjustJob
) => {
  if ("spans" in data && data.spans?.length >= 200) {
    console.log("Too many spans, maximum of 200 per trace, dropping job");
    return;
  }

  const start = Date.now();
  if ("action" in data && data.action === "check_and_adjust") {
    getJobProcessingCounter("collector_check_and_adjust", "processing").inc();
    const result = await processCollectorCheckAndAdjustJob(id, data);
    getJobProcessingCounter("collector_check_and_adjust", "completed").inc();
    const duration = Date.now() - start;
    getJobProcessingDurationHistogram("collector_check_and_adjust").observe(
      duration
    );
    return result;
  }
  getJobProcessingCounter("collector", "processing").inc();
  const result = await processCollectorJob_(id, data as CollectorJob);
  getJobProcessingCounter("collector", "completed").inc();
  const duration = Date.now() - start;
  getJobProcessingDurationHistogram("collector").observe(duration);
  return result;
};

const processCollectorJob_ = async (
  id: string | undefined,
  data: CollectorJob
) => {
  debug(`Processing job ${id} with data:`, JSON.stringify(data));

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

  const esSpans: ElasticSearchSpan[] = spans.map((span) => {
    const esSpan = {
      ...span,
      input: span.input ? typedValueToElasticSearch(span.input) : null,
      output: span.output ? typedValueToElasticSearch(span.output) : null,
      project_id: project.id,
      timestamps: {
        ...span.timestamps,
        inserted_at: Date.now(),
        updated_at: Date.now(),
      },
    };
    if (esSpan.params && typeof span.params === "object") {
      esSpan.params = {
        ...esSpan.params,
        _keys: flattenObjectKeys(esSpan.params),
      };
    } else {
      // Fix for open search, nested fields cannot be explicitly set to null if empty
      delete esSpan.params;
    }
    return esSpan;
  });

  let existingSpans: Span[] = [];
  if (existingTrace?.inserted_at) {
    const existingTraceResponse = await esClient.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      body: {
        size: 1,
        query: {
          bool: {
            must: [
              { term: { trace_id: traceId } },
              { term: { project_id: project.id } },
            ] as QueryDslBoolQuery["must"],
          } as QueryDslBoolQuery,
        },
        _source: ["spans"],
      },
    });
    existingSpans = (
      existingTraceResponse.hits.hits[0]?._source?.spans ?? []
    ).map(elasticSearchSpanToSpan);
  }

  const allSpans = existingSpans.concat(spans);
  const [input, output] = await Promise.all([
    getTraceInput(allSpans, project.id, true),
    getTraceOutput(allSpans, project.id, true),
  ]);
  const error = getLastOutputError(spans);

  const evaluations = mapEvaluations(data);

  const customExistingMetadata = existingTrace?.existing_metadata?.custom ?? {};
  const existingAllKeys = existingTrace?.existing_metadata?.all_keys ?? [];
  if (existingTrace?.existing_metadata) {
    delete existingTrace?.existing_metadata.custom;
    delete existingTrace?.existing_metadata.all_keys;
  }

  // Create the trace
  const trace: ElasticSearchTrace = {
    trace_id: traceId,
    project_id: project.id,
    metadata: {
      ...(existingTrace?.existing_metadata ?? {}),
      ...reservedTraceMetadata,
      ...(Object.keys(customMetadata).length > 0
        ? {
            ...customExistingMetadata,
            custom: customMetadata,
          }
        : {}),
      all_keys: Array.from(
        new Set([
          ...existingAllKeys,
          ...Object.keys(reservedTraceMetadata),
          ...flattenObjectKeys(customMetadata),
        ])
      ),
    },
    timestamps: {
      ...(!existingTrace?.inserted_at
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
    indexing_md5s: [...(existingTrace?.indexing_md5s ?? []), paramsMD5]
      .reverse()
      .slice(0, 10)
      .reverse(),
  };

  const piiEnforced = env.NODE_ENV === "production";
  await cleanupPIIs(trace, esSpans, {
    piiRedactionLevel: project.piiRedactionLevel,
    enforced: piiEnforced,
  });

  await esClient.update({
    index: TRACE_INDEX.alias,
    id: traceIndexId({ traceId, projectId: project.id }),
    retry_on_conflict: 10,
    body: {
      script: {
        source: `
          // Update the document with the trace data
          if (ctx._source == null) {
            ctx._source = params.trace;
          } else {
            // Deep merge
            for (String key : params.trace.keySet()) {
              if (params.trace[key] instanceof Map) {
                if (!ctx._source.containsKey(key) || !(ctx._source[key] instanceof Map)) {
                  ctx._source[key] = new HashMap();
                }
                Map nestedSource = ctx._source[key];
                Map nestedUpdate = params.trace[key];
                for (String nestedKey : nestedUpdate.keySet()) {
                  nestedSource[nestedKey] = nestedUpdate[nestedKey];
                }
              } else {
                ctx._source[key] = params.trace[key];
              }
            }
          }

          def currentTime = System.currentTimeMillis();

          // Handle spans
          if (ctx._source.spans == null) {
            ctx._source.spans = [];
          }
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

          // Limit the number of spans to 200
          if (ctx._source.spans != null && ctx._source.spans.size() > 200) {
            ctx._source.spans = ctx._source.spans.subList(ctx._source.spans.size() - 200, ctx._source.spans.size());
          }

          // Handle evaluations
          for (def newEvaluation : params.newEvaluations) {
            if (ctx._source.evaluations == null) {
              ctx._source.evaluations = [];
            }
            def existingEvaluationIndex = -1;
            for (int i = 0; i < ctx._source.evaluations.size(); i++) {
              if (ctx._source.evaluations[i].evaluator_id == newEvaluation.evaluator_id) {
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

          // Limit the number of evaluations to 50
          if (ctx._source.evaluations != null && ctx._source.evaluations.size() > 50) {
            ctx._source.evaluations = ctx._source.evaluations.subList(
              ctx._source.evaluations.size() - 50,
              ctx._source.evaluations.size()
            );
          }
        `,
        lang: "painless",
        params: {
          trace,
          newSpans: esSpans,
          newEvaluations: evaluations ?? [],
        },
      },
      upsert: {
        ...trace,
        spans: esSpans,
        ...(evaluations ? { evaluations } : {}),
      },
    },
    refresh: true,
  });

  void markProjectFirstMessage(project);

  const checkAndAdjust = async (postfix = "") => {
    return collectorQueue!.add(
      "collector",
      {
        action: "check_and_adjust",
        traceId,
        projectId,
      },
      {
        jobId: `collector_${traceId}_check_and_adjust${postfix}`,
        delay: 3000,
      }
    );
  };

  const job = await checkAndAdjust();
  try {
    // Push it forward if two traces are processed at the same time
    await job?.changeDelay(3000);
  } catch {
    try {
      // Remove the existing job and start a new one to rerun adjust
      await job.remove();
      await checkAndAdjust();
    } catch {
      // If that fails too because adjust is running, start a new job with different id for later
      await checkAndAdjust("_2");
    }
  }
};

const processCollectorCheckAndAdjustJob = async (
  id: string | undefined,
  data: CollectorCheckAndAdjustJob
) => {
  debug(`Post-processing job ${id}`);

  const { traceId, projectId } = data;
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
      _source: [
        "spans",
        "timestamps.inserted_at",
        "metadata",
        "expected_output",
      ],
    },
  });

  const existingTrace = existingTraceResponse.hits.hits[0]?._source;
  if (!existingTrace) {
    return;
  }

  const spans = existingTrace.spans?.map(elasticSearchSpanToSpan) ?? [];
  const [input, output] = await Promise.all([
    getTraceInput(spans, projectId),
    getTraceOutput(spans, projectId),
  ]);
  const error = getLastOutputError(spans);

  const trace: Pick<
    ElasticSearchTrace,
    | "trace_id"
    | "project_id"
    | "input"
    | "output"
    | "error"
    | "metadata"
    | "expected_output"
  > = {
    trace_id: traceId,
    project_id: projectId,
    input,
    output,
    error,
    metadata: existingTrace.metadata,
    expected_output: existingTrace.expected_output,
  };

  await esClient.update({
    index: TRACE_INDEX.alias,
    id: traceIndexId({ traceId, projectId }),
    retry_on_conflict: 10,
    body: {
      script: {
        source: `
          if (params.input != null) {
            ctx._source.input = params.input;
          }
          if (params.output != null) {
            ctx._source.output = params.output;
          }
          if (params.error != null) {
            ctx._source.error = params.error;
          }
        `,
        lang: "painless",
        params: {
          input: input ?? null,
          output: output ?? null,
          error: error ?? null,
        },
      },
    },
    refresh: true,
  });

  // Does not re-schedule trace checks for too old traces being resynced
  if (
    !existingTrace?.timestamps?.inserted_at ||
    existingTrace.timestamps.inserted_at > Date.now() - 30 * 1000
  ) {
    await scheduleEvaluations(trace, spans);
  }

  try {
    await scoreSatisfactionFromInput({
      traceId,
      projectId,
      input,
    });
  } catch {
    debug("Failed to score satisfaction for", traceId);
  }
};

export const startCollectorWorker = () => {
  if (!connection) {
    debug("No redis connection, skipping collector worker");
    return;
  }

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
    if (
      job?.data &&
      "action" in job.data &&
      job.data.action === "check_and_adjust"
    ) {
      getJobProcessingCounter("collector_check_and_adjust", "failed").inc();
    } else {
      getJobProcessingCounter("collector", "failed").inc();
    }
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
      existing_metadata: ElasticSearchTrace["metadata"];
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
      _source: ["indexing_md5s", "timestamps.inserted_at", "metadata"],
    },
  });

  const existingTrace = existingTraceResponse.hits.hits[0]?._source;
  if (!existingTrace) {
    return undefined;
  }

  return {
    indexing_md5s: existingTrace.indexing_md5s,
    inserted_at: existingTrace.timestamps?.inserted_at,
    existing_metadata: existingTrace.metadata,
  };
};
