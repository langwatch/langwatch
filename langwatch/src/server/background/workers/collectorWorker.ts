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
import { COLLECTOR_QUEUE } from "../queues/collectorQueue";
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

const debug = getDebugger("langwatch:workers:collectorWorker");

export const processCollectorJob = async (
  id: string | undefined,
  data: CollectorJob
) => {
  debug(`Processing job ${id} with data:`, data);

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
    index: TRACE_INDEX,
    id: traceIndexId({ traceId, projectId: project.id }),
    retry_on_conflict: 5,
    body: {
      doc: trace,
      doc_as_upsert: true,
    },
  });

  await esClient.update({
    index: TRACE_INDEX,
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
              ctx._source.spans[existingSpanIndex] = newSpan;
            } else {
              if (newSpan.timestamps == null) {
                newSpan.timestamps = new HashMap();
              }
              newSpan.timestamps.inserted_at = currentTime;
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
    Sentry.captureException(err);
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
