import type { Project } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../server/db"; // Adjust the import based on your setup
import { SPAN_INDEX, TRACE_INDEX, esClient } from "../../server/elasticsearch";
import {
  type CollectorRESTParamsValidator,
  type ElasticSearchInputOutput,
  type ElasticSearchSpan,
  type ErrorCapture,
  type Span,
  type SpanInput,
  type SpanOutput,
  type Trace,
} from "../../server/tracer/types";
import {
  collectorRESTParamsValidatorSchema,
  spanValidatorSchema,
} from "../../server/tracer/types.generated";
import { getDebugger } from "../../utils/logger";
import { addInputAndOutputForRAGs } from "./collector/rag";
import {
  getSearchEmbeddings,
  getTraceInput,
  getTraceOutput,
} from "./collector/trace";
import { addLLMTokensCount, computeTraceMetrics } from "./collector/metrics";
import { scheduleTraceChecks } from "./collector/traceChecks";
import { cleanupPII } from "./collector/cleanupPII";

export const debug = getDebugger("langwatch:collector");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const authToken = req.headers["x-auth-token"];

  if (!authToken) {
    return res
      .status(401)
      .json({ message: "X-Auth-Token header is required." });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  let params: CollectorRESTParamsValidator;
  try {
    params = collectorRESTParamsValidatorSchema.parse(req.body);
  } catch (error) {
    debug(
      "Invalid trace received",
      error,
      JSON.stringify(req.body, null, "  ")
    );
    Sentry.captureException(error);
    return res.status(400).json({ error: "Invalid trace format." });
  }

  const {
    trace_id: nullableTraceId,
    thread_id: threadId,
    user_id: userId,
    customer_id: customerId,
    labels,
  } = params;

  if (!req.body.spans) {
    return res.status(400).json({ message: "Bad request" });
  }

  const spans = addInputAndOutputForRAGs(
    await addLLMTokensCount((req.body as Record<string, any>).spans as Span[])
  );
  spans.forEach((span) => {
    if (nullableTraceId && !span.trace_id) {
      span.trace_id = nullableTraceId;
    }
  });
  const traceId = nullableTraceId ?? spans[0]?.trace_id;
  if (!traceId) {
    return res.status(400).json({ message: "Trace ID not defined" });
  }

  for (const span of spans) {
    try {
      spanValidatorSchema.parse(span);
    } catch (error) {
      debug("Invalid span received", error, JSON.stringify(span, null, "  "));
      Sentry.captureException(error);
      return res.status(400).json({ error: "Invalid span format." });
    }
  }

  const esSpans: ElasticSearchSpan[] = spans.map((span) => ({
    ...span,
    input: span.input ? typedValueToElasticSearch(span.input) : null,
    outputs: span.outputs.map(typedValueToElasticSearch),
    project_id: project.id,
    // TODO: test
    raw_response:
      "raw_response" in span && span.raw_response
        ? JSON.stringify(span.raw_response)
        : null,
  }));

  const traceIds = Array.from(
    new Set(spans.filter((span) => span.trace_id).map((span) => span.trace_id))
  );
  if (!traceIds[0] || traceIds.length > 1 || traceIds[0] != traceId) {
    return res
      .status(400)
      .json({ message: "All spans must have the same trace id" });
  }

  debug(`collecting traceId ${traceId}`);

  const [input, output] = await Promise.all([
    getTraceInput(spans),
    getTraceOutput(spans),
  ]);
  const error = getLastOutputError(spans);
  const openAISearchEmbeddings = await getSearchEmbeddings(
    input,
    output,
    error
  );

  const nullToUndefined = <T>(value: T | null): T | undefined =>
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    value === null ? undefined : value;

  // Create the trace
  const trace: Trace = {
    id: traceId,
    project_id: project.id,
    thread_id: nullToUndefined(threadId), // Optional: This will be undefined if not sent
    user_id: nullToUndefined(userId), // Optional: This will be undefined if not sent
    customer_id: nullToUndefined(customerId),
    labels: nullToUndefined(labels),
    timestamps: {
      started_at: Math.min(...spans.map((span) => span.timestamps.started_at)),
      inserted_at: Date.now(),
    },
    input,
    output,
    metrics: computeTraceMetrics(spans),
    error,
    search_embeddings: {
      openai_embeddings: openAISearchEmbeddings,
    },
  };

  await cleanupPII(trace, esSpans);

  await esClient.index({
    index: TRACE_INDEX,
    id: trace.id,
    body: trace,
  });

  const result = await esClient.helpers.bulk({
    datasource: esSpans,
    pipeline: "ent-search-generic-ingestion",
    onDocument: (doc) => ({
      index: { _index: SPAN_INDEX, _id: doc.id, routing: doc.trace_id },
    }),
  });

  if (result.failed > 0) {
    console.error("Failed to insert to elasticsearch", result);
    return res.status(500).json({ message: "Something went wrong!" });
  }

  void scheduleTraceChecks(trace, spans);

  await markProjectFirstMessage(project);

  return res.status(200).json({ message: "Traces received successfully." });
}

const typedValueToElasticSearch = (
  typed: SpanInput | SpanOutput
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
