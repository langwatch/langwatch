import type { Project } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { Worker } from "bullmq";
import type {
  CollectorCheckAndAdjustJob,
  CollectorJob,
} from "~/server/background/types";
import { env } from "../../../env.mjs";
import { createLogger } from "../../../utils/logger";
import { safeTruncate } from "../../../utils/truncate";
import { flattenObjectKeys, getProtectionsForProject } from "../../api/utils";
import { prisma } from "../../db";
import { TRACE_INDEX, esClient, traceIndexId } from "../../elasticsearch";
import {
  collectorIndexDelayHistogram,
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../../metrics";
import { connection } from "../../redis";
import {
  type ElasticSearchInputOutput,
  type ElasticSearchSpan,
  type ElasticSearchTrace,
  type ErrorCapture,
  type Evaluation,
  type Span,
  type SpanInputOutput,
  type SpanTimestamps,
} from "../../tracer/types";
import { COLLECTOR_QUEUE, collectorQueue } from "../queues/collectorQueue";
import { getFirstInputAsText, getLastOutputAsText } from "./collector/common";
import { mapEvaluations, scheduleEvaluations } from "./collector/evaluations";
import {
  addGuardrailCosts,
  addLLMTokensCount,
  computeTraceMetrics,
} from "./collector/metrics";
import { cleanupPIIs } from "./collector/piiCheck";
import { addInputAndOutputForRAGs } from "./collector/rag";
import { scoreSatisfactionFromInput } from "./collector/satisfaction";
import {
  searchTraces,
  getTraceById,
  searchTracesWithInternals,
} from "~/server/elasticsearch/traces";
import { prewarmTiktokenModels } from "./collector/cost";

const logger = createLogger("langwatch:workers:collectorWorker");

export const scheduleTraceCollectionWithFallback = async (
  collectorJob: CollectorJob,
  forceSync = false
) => {
  if (forceSync || !collectorQueue) {
    logger.debug("force sync enabled, processing job synchronously");
    await processCollectorJob(undefined, collectorJob);
    return;
  }

  await scheduleTraceCollectionWithGrouping(collectorJob);
};

/**
 * Schedules a trace collection job with grouping.
 *
 * The way this works is, we generate a job id that will be unique for a given trace for that minute
 * so if another job comes along within the same minute, they will be merged together, instead of creating
 * two jobs before processing. We then push the job forward by 10 seconds to wait for more possible spans to come in.
 *
 * If there is a job in the same minute, but it's already being processed, then nothing we can do, we increase an index
 * to create another group, this one has 10s buffer for new spans to come in. This ensure smallest latency for single
 * trace, while grouping efficiently for distributed tracing.
 *
 */
const localLocks: Record<string, boolean> = {};
export const scheduleTraceCollectionWithGrouping = async (
  collectorJob: CollectorJob
) => {
  const yyyymmddhhmm = new Date()
    .toISOString()
    .replace(/[-:Z]/g, "")
    .slice(0, 13);
  const baseJobId = `collector_${collectorJob.projectId}_${collectorJob.traceId}_${yyyymmddhhmm}`;

  while (localLocks[baseJobId]) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  localLocks[baseJobId] = true;

  try {
    let jobId = baseJobId;

    let existingJob = await collectorQueue.getJob(jobId);
    let index = 1;
    while (existingJob && (await existingJob.isActive())) {
      index++;
      jobId = `${baseJobId}_${index}`;
      existingJob = await collectorQueue.getJob(jobId);
    }

    if (existingJob && "spans" in existingJob.data) {
      logger.debug(
        { collectionJobTraceId: collectorJob.traceId },
        "found existing job trace, merging..."
      );
      const mergedJob = mergeCollectorJobs(existingJob.data, collectorJob);
      await existingJob.remove();
      await collectorQueue.add("collector", mergedJob, {
        jobId,
        delay: 10_000,
      });
    } else {
      logger.debug(
        { collectionJobTraceId: collectorJob.traceId },
        "collecting job trace"
      );
      await collectorQueue.add("collector", collectorJob, {
        jobId,
        delay: index > 1 ? 10_000 : 0,
      });
    }
  } finally {
    localLocks[baseJobId] = false;
  }
};

const mergeCollectorJobs = (
  job1: CollectorJob,
  job2: CollectorJob
): CollectorJob => {
  return {
    ...job1,
    spans: [...(job1.spans ?? []), ...(job2.spans ?? [])],
    evaluations: [...(job1.evaluations ?? []), ...(job2.evaluations ?? [])],
    reservedTraceMetadata: {
      ...job1.reservedTraceMetadata,
      ...job2.reservedTraceMetadata,
    },
    customMetadata: {
      ...job1.customMetadata,
      ...job2.customMetadata,
    },
    existingTrace: {
      ...job1.existingTrace,
      ...job2.existingTrace,
      indexing_md5s: [
        ...(job1.existingTrace?.indexing_md5s ?? []),
        ...(job2.existingTrace?.indexing_md5s ?? []),
      ],
    },
    collectedAt: Math.min(job1.collectedAt, job2.collectedAt),
  };
};

export async function processCollectorJob(
  id: string | undefined,
  data: CollectorJob | CollectorCheckAndAdjustJob
) {
  if ("spans" in data && data.spans?.length > 200) {
    logger.warn(
      { spansLength: data.spans?.length, jobId: id },
      "too many spans, maximum of 200 per trace, dropping job"
    );
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

  Sentry.getCurrentScope().setPropagationContext({
    traceId: data.traceId,
    sampleRand: 1,
    parentSpanId: data.traceId,
  });

  const result = await Sentry.startSpan(
    {
      name: "Process Collector Job",
      op: "rootSpan",
      attributes: {
        traceId: data.traceId,
      },
    },
    async () => {
      return await processCollectorJob_(id, data as CollectorJob);
    }
  );

  getJobProcessingCounter("collector", "completed").inc();
  const duration = Date.now() - start;
  getJobProcessingDurationHistogram("collector").observe(duration);
  return result;
}

const processCollectorJob_ = async (
  id: string | undefined,
  data: CollectorJob
) => {
  logger.debug({ jobId: id, data }, "processing job");

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

  spans = addGuardrailCosts(spans);
  try {
    spans = await addLLMTokensCount(projectId, spans);
  } catch (error) {
    logger.debug(
      { error, projectId: project.id, traceId },
      "failed to add LLM tokens count"
    );
    Sentry.captureException(new Error("Failed to add LLM tokens count"), {
      extra: { projectId: project.id, traceId, error: error },
    });
  }
  spans = addInputAndOutputForRAGs(spans);

  const esSpans: ElasticSearchSpan[] = spans.map((span) => {
    const currentTime = Date.now();
    const esSpan: ElasticSearchSpan = {
      ...span,
      input: span.input ? typedValueToElasticSearch(span.input) : null,
      output: span.output ? typedValueToElasticSearch(span.output) : null,
      project_id: project.id,
      timestamps: {
        ...span.timestamps,
        // If ignore_timestamps_on_write is set, we'll preserve existing timestamps in the ES update script
        // For now, set the required fields but they may be overridden during update
        inserted_at: span.timestamps.ignore_timestamps_on_write ? (existingTrace?.inserted_at ?? currentTime) : currentTime,
        updated_at: currentTime,
      },
    };
    if (esSpan.params && typeof span.params === "object") {
      esSpan.params = {
        ...safeTruncate(esSpan.params),
        _keys: flattenObjectKeys(esSpan.params),
      };
    } else {
      // Fix for open search, nested fields cannot be explicitly set to null if empty
      delete esSpan.params;
    }
    return esSpan;
  });

  const existingSpans: Span[] = [];
  const existingEvaluations: Evaluation[] = [];

  if (existingTrace?.inserted_at) {
    // TODO: check for quickwit
    const protections = await getProtectionsForProject(prisma, {
      projectId: project.id,
    });
    const existingTraceResponse = await getTraceById({
      connConfig: { projectId: project.id },
      traceId: traceId,
      protections,
      includeEvaluations: true,
      includeSpans: true,
    });
    if (existingTraceResponse) {
      existingSpans.push(...existingTraceResponse.spans);

      if (existingTraceResponse.evaluations) {
        existingEvaluations.push(...existingTraceResponse.evaluations);
      }
    }
  }

  const allSpans = existingSpans.concat(spans);
  const [input, output] = await Promise.all([
    { value: getFirstInputAsText(allSpans) },
    { value: getLastOutputAsText(allSpans) },
  ]);
  const error = getLastOutputError(spans);

  const evaluations = mapEvaluations(data)?.concat(existingEvaluations);

  const customExistingMetadata = existingTrace?.existing_metadata?.custom ?? {};
  const existingAllKeys = existingTrace?.existing_metadata?.all_keys ?? [];
  if (existingTrace?.existing_metadata) {
    delete existingTrace?.existing_metadata.custom;
    delete existingTrace?.existing_metadata.all_keys;
  }

  // Check if any spans have ignore_timestamps_on_write flag
  const hasIgnoreTimestamps = spans.some((span) => span.timestamps.ignore_timestamps_on_write);
  
  // Create the trace
  const trace: Omit<ElasticSearchTrace, "spans"> = {
    trace_id: traceId,
    project_id: project.id,
    metadata: {
      ...(existingTrace?.existing_metadata ?? {}),
      ...reservedTraceMetadata,
      ...(Object.keys(customMetadata).length > 0
        ? {
            ...customExistingMetadata,
            custom: safeTruncate(customMetadata),
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
      // If any span has ignore_timestamps_on_write, preserve existing trace timestamps where possible
      started_at: hasIgnoreTimestamps && existingTrace?.inserted_at
        ? (existingSpans.length > 0 
            ? Math.min(...existingSpans.map((span) => span.timestamps.started_at))
            : Math.min(...allSpans.map((span) => span.timestamps.started_at))
          )
        : Math.min(...allSpans.map((span) => span.timestamps.started_at)) ?? Date.now(),
      inserted_at: existingTrace?.inserted_at ?? Date.now(),
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

  if (
    !process.env.DISABLE_PII_REDACTION &&
    project.piiRedactionLevel !== "DISABLED"
  ) {
    const piiEnforced = env.NODE_ENV === "production";
    await cleanupPIIs(trace, esSpans, {
      piiRedactionLevel: project.piiRedactionLevel,
      enforced: piiEnforced,
    });
  }

  await Sentry.startSpan({ name: "updateTrace" }, async () => {
    await updateTrace(trace, esSpans, evaluations);
  });

  if (!existingTrace?.inserted_at) {
    const delay = Date.now() - data.collectedAt;
    collectorIndexDelayHistogram.observe(delay);
  }

  void markProjectFirstMessage(project, trace.metadata);

  if (env.IS_QUICKWIT) {
    // Skip check and adjust for quickwit
    return;
  }

  const checkAndAdjust = async (postfix = "") => {
    return collectorQueue.add(
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
      await job?.remove();
      await checkAndAdjust();
    } catch {
      // If that fails too because adjust is running, start a new job with different id for later
      await checkAndAdjust("_2");
    }
  }
};

const updateTrace = async (
  trace: Omit<ElasticSearchTrace, "spans">,
  esSpans: ElasticSearchSpan[],
  evaluations: Evaluation[] | undefined
) => {
  if (env.IS_QUICKWIT) {
    const client = await esClient({ projectId: trace.project_id });
    return await client.update({
      index: TRACE_INDEX.alias,
      id: traceIndexId({
        traceId: trace.trace_id,
        projectId: trace.project_id,
      }),
      retry_on_conflict: 10,
      doc: {
        ...trace,
        spans: esSpans,
        ...(evaluations ? { evaluations } : {}),
      },
      doc_as_upsert: true,
    });
  }

  // @ts-expect-error
  delete trace.spans;

  try {
    const client = await esClient({ projectId: trace.project_id });
    await client.update({
      index: TRACE_INDEX.alias,
      id: traceIndexId({
        traceId: trace.trace_id,
        projectId: trace.project_id,
      }),
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
              def existingSpan = ctx._source.spans[existingSpanIndex];
              if (newSpan.timestamps == null) {
                newSpan.timestamps = new HashMap();
                newSpan.timestamps.inserted_at = currentTime;
              }
              
              // If ignore_timestamps_on_write is set, preserve existing timestamps where possible
              if (newSpan.timestamps.ignore_timestamps_on_write == true && existingSpan.timestamps != null) {
                newSpan.timestamps.started_at = existingSpan.timestamps.started_at;
                newSpan.timestamps.inserted_at = existingSpan.timestamps.inserted_at;
                if (existingSpan.timestamps.first_token_at != null) {
                  newSpan.timestamps.first_token_at = existingSpan.timestamps.first_token_at;
                }
                if (existingSpan.timestamps.finished_at != null) {
                  newSpan.timestamps.finished_at = existingSpan.timestamps.finished_at;
                }
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
              def existingEvaluation = ctx._source.evaluations[existingEvaluationIndex];
              if (newEvaluation.timestamps == null) {
                newEvaluation.timestamps = new HashMap();
                newEvaluation.timestamps.inserted_at = currentTime;
              }
              
              // If ignore_timestamps_on_write is set, preserve existing timestamps where possible
              if (newEvaluation.timestamps.ignore_timestamps_on_write == true && existingEvaluation.timestamps != null) {
                if (existingEvaluation.timestamps.started_at != null) {
                  newEvaluation.timestamps.started_at = existingEvaluation.timestamps.started_at;
                }
                if (existingEvaluation.timestamps.inserted_at != null) {
                  newEvaluation.timestamps.inserted_at = existingEvaluation.timestamps.inserted_at;
                }
                if (existingEvaluation.timestamps.finished_at != null) {
                  newEvaluation.timestamps.finished_at = existingEvaluation.timestamps.finished_at;
                }
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
  } catch (error) {
    if (
      (error as any).toString().includes("version_conflict_engine_exception")
    ) {
      logger.debug("version conflict, skipping update");
      return;
    }
    throw error;
  }
};

export const processCollectorCheckAndAdjustJob = async (
  id: string | undefined,
  data: CollectorCheckAndAdjustJob
) => {
  logger.debug({ jobId: id }, "post-processing job");

  const { traceId, projectId } = data;
  const client = await esClient({ projectId });
  const protections = await getProtectionsForProject(prisma, { projectId });
  const existingTraceResponse = await searchTraces({
    connConfig: { projectId },
    search: {
      size: 1,
      query: {
        bool: {
          must: [
            { term: { trace_id: traceId } },
            { term: { project_id: projectId } },
          ],
          should: void 0,
          must_not: void 0,
        },
      },
      _source: [
        "spans",
        "timestamps.inserted_at",
        "metadata",
        "expected_output",
      ],
    },
    protections,
  });
  const existingTrace = existingTraceResponse[0];
  if (!existingTrace) {
    return;
  }

  const spans = existingTrace.spans;
  const [input, output] = await Promise.all([
    { value: getFirstInputAsText(spans) },
    { value: getLastOutputAsText(spans) },
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

  await client.update({
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

  const customMetadata = existingTrace.metadata.custom;
  const isCustomMetadataObject =
    typeof customMetadata === "object" &&
    customMetadata !== null &&
    !Array.isArray(customMetadata);

  if (
    // Does not re-schedule trace checks for too old traces being resynced
    (!existingTrace?.timestamps?.inserted_at ||
      existingTrace.timestamps.inserted_at > Date.now() - 30 * 1000) &&
    // Does not schedule evaluations for traces that are not from the studio in development
    (!isCustomMetadataObject || // If it's not an object, proceed with evaluations
      customMetadata?.platform !== "optimization_studio" ||
      customMetadata?.environment !== "development")
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
    logger.debug({ traceId }, "failed to score satisfaction for");
  }
};

export const startCollectorWorker = () => {
  if (!connection) {
    logger.debug("no redis connection, skipping collector worker");
    return;
  }

  prewarmTiktokenModels();

  const collectorWorker = new Worker<CollectorJob, void, string>(
    COLLECTOR_QUEUE,
    (job) => processCollectorJob(job.id, job.data),
    {
      connection,
      concurrency: 20,
    }
  );

  collectorWorker.on("ready", () => {
    logger.debug("collector worker active, waiting for jobs!");
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
    logger.debug({ jobId: job?.id, error: err.message }, "job failed");
    Sentry.withScope((scope) => {
      scope.setTag("worker", "collector");
      scope.setExtra("job", job?.data);
      Sentry.captureException(err);
    });
  });

  logger.debug("collector worker registered");
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

const markProjectFirstMessage = async (
  project: Project,
  metadata: ElasticSearchTrace["metadata"]
) => {
  if (!project.firstMessage && !project.integrated) {
    await prisma.project.update({
      where: { id: project.id },
      data: {
        firstMessage: true,
        integrated:
          metadata.custom?.platform === "optimization_studio"
            ? project.integrated
            : true,
        language:
          metadata.custom?.platform === "optimization_studio"
            ? "other"
            : metadata.sdk_language === "python"
            ? "python"
            : metadata.sdk_language === "typescript"
            ? "typescript"
            : "other",
      },
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
      version: number | undefined;
    }
  | undefined
> => {
  const existingTracesWithInternals = await searchTracesWithInternals({
    connConfig: { projectId },
    protections: {
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
      canSeeCosts: true,
    },
    search: {
      size: 1,
      query: {
        bool: {
          must: [
            { term: { trace_id: traceId } },
            { term: { project_id: projectId } },
          ],
          must_not: void 0,
          should: void 0,
        },
      },
      _source: ["indexing_md5s", "timestamps.inserted_at", "metadata"],
    },
  });

  const existingTraceWithInternals = existingTracesWithInternals[0];
  if (!existingTraceWithInternals) {
    return void 0;
  }

  const source = existingTraceWithInternals.source;
  const version = existingTraceWithInternals.hit?._version;

  return {
    indexing_md5s: source.indexing_md5s,
    inserted_at: source.timestamps?.inserted_at,
    existing_metadata: source.metadata,
    version,
  };
};
