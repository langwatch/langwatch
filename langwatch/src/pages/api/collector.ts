import type { Project } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../server/db"; // Adjust the import based on your setup
import {
  SPAN_INDEX,
  TRACE_INDEX,
  esClient,
  spanIndexId,
  traceIndexId,
} from "../../server/elasticsearch";
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
import {
  addInputAndOutputForRAGs,
  maybeAddIdsToContextList,
} from "./collector/rag";
import {
  getSearchEmbeddings,
  getTraceInput,
  getTraceOutput,
} from "./collector/trace";
import { addLLMTokensCount, computeTraceMetrics } from "./collector/metrics";
import { scheduleTraceChecks } from "./collector/traceChecks";
import { cleanupPII } from "./collector/cleanupPII";
import { scoreSatisfactionFromInput } from "./collector/satisfaction";
import crypto from "crypto";

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

  // We migrated those keys to inside metadata, but we still want to support them for retrocompatibility for a while
  if (!("metadata" in req.body)) {
    req.body.metadata = {};
    if ("thread_id" in req.body) {
      req.body.metadata.thread_id = req.body.thread_id;
    }
    if ("user_id" in req.body) {
      req.body.metadata.user_id = req.body.user_id;
    }
    if ("customer_id" in req.body) {
      req.body.metadata.customer_id = req.body.customer_id;
    }
    if ("labels" in req.body) {
      req.body.metadata.labels = req.body.labels;
    }
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

  const { trace_id: nullableTraceId } = params;
  const {
    thread_id: threadId,
    user_id: userId,
    customer_id: customerId,
    labels,
  } = params.metadata ?? {};

  if (!req.body.spans) {
    return res.status(400).json({ message: "Bad request" });
  }

  let spans = (req.body as Record<string, any>).spans as Span[];
  spans.forEach((span) => {
    // We changed "id" to "span_id", but we still want to support "id" for retrocompatibility for a while
    if ("id" in span) {
      span.span_id = span.id as string;
    }
    if (nullableTraceId && !span.trace_id) {
      span.trace_id = nullableTraceId;
    }
    // Makes outputs optional, but our system still expects it to be an array
    if (typeof span.outputs === "undefined") {
      span.outputs = [];
    }
    if ("contexts" in span) {
      // Keep retrocompatibility of RAG as a simple string list
      span.contexts = maybeAddIdsToContextList(span.contexts);
      // Allow number ids
      span.contexts = span.contexts.map((context) => ({
        ...context,
        ...(typeof context.document_id === "number"
          ? { document_id: `${context.document_id as number}` }
          : {}),
        ...(typeof context.chunk_id === "number"
          ? { chunk_id: `${context.chunk_id as number}` }
          : {}),
      }));
    }
  });

  const traceId = nullableTraceId ?? spans[0]?.trace_id;
  if (!traceId) {
    return res.status(400).json({ message: "Trace ID not defined" });
  }

  const traceIds = Array.from(
    new Set(spans.filter((span) => span.trace_id).map((span) => span.trace_id))
  );
  if (!traceIds[0] || traceIds.length > 1 || traceIds[0] != traceId) {
    return res
      .status(400)
      .json({ message: "All spans must have the same trace id" });
  }

  for (const span of spans) {
    try {
      spanValidatorSchema.parse(span);
    } catch (error) {
      debug("Invalid span received", error, JSON.stringify(span, null, "  "));
      Sentry.captureException(error);
      return res.status(400).json({ error: "Invalid span format." });
    }

    if (
      (span.timestamps.started_at &&
        span.timestamps.started_at.toString().length === 10) ||
      (span.timestamps.finished_at &&
        span.timestamps.finished_at.toString().length === 10) ||
      (span.timestamps.first_token_at &&
        span.timestamps.first_token_at.toString().length === 10)
    ) {
      return res.status(400).json({
        error:
          "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
      });
    }
  }

  const paramsMD5 = crypto
    .createHash("md5")
    .update(JSON.stringify({ ...params, spans }))
    .digest("hex");
  const existingMD5s = await fetchExistingMD5s(traceId, project.id);
  if (existingMD5s?.includes(paramsMD5)) {
    return res.status(200).json({ message: "No changes" });
  }

  debug(`collecting traceId ${traceId}`);

  spans = addInputAndOutputForRAGs(await addLLMTokensCount(spans));

  const esSpans: ElasticSearchSpan[] = spans.map((span) => ({
    ...span,
    input: span.input ? typedValueToElasticSearch(span.input) : null,
    outputs: span.outputs.map(typedValueToElasticSearch),
    project_id: project.id,
    timestamps: {
      ...span.timestamps,
      inserted_at: Date.now(),
    },
    // TODO: test
    raw_response:
      "raw_response" in span && span.raw_response
        ? JSON.stringify(span.raw_response)
        : null,
  }));

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
    trace_id: traceId,
    project_id: project.id,
    metadata: {
      thread_id: nullToUndefined(threadId), // Optional: This will be undefined if not sent
      user_id: nullToUndefined(userId), // Optional: This will be undefined if not sent
      customer_id: nullToUndefined(customerId),
      labels: nullToUndefined(labels),
    },
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
    indexing_md5s: [...(existingMD5s ?? []), paramsMD5],
  };

  await cleanupPII(trace, esSpans);

  const result = await esClient.helpers.bulk({
    datasource: esSpans,
    pipeline: "ent-search-generic-ingestion",
    onDocument: (doc) => ({
      index: {
        _index: SPAN_INDEX,
        _id: spanIndexId({ spanId: doc.span_id, projectId: project.id }),
        routing: traceIndexId({ traceId, projectId: project.id }),
      },
    }),
  });

  if (result.failed > 0) {
    console.error("Failed to insert to elasticsearch", result);
    return res.status(500).json({ message: "Something went wrong!" });
  }

  await esClient.index({
    index: TRACE_INDEX,
    id: traceIndexId({ traceId, projectId: project.id }),
    body: trace,
  });

  void scheduleTraceChecks(trace, spans);

  await markProjectFirstMessage(project);

  try {
    await scoreSatisfactionFromInput({
      traceId: trace.trace_id,
      projectId: trace.project_id,
      input: trace.input,
    });
  } catch {
    console.warn("Failed to score satisfaction for", trace.trace_id);
  }

  return res.status(200).json({ message: "Trace received successfully." });
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

const fetchExistingMD5s = async (
  traceId: string,
  projectId: string
): Promise<Trace["indexing_md5s"] | undefined> => {
  const existingTraceResponse = await esClient.search<Trace>({
    index: TRACE_INDEX,
    body: {
      size: 1,
      query: {
        //@ts-ignore
        bool: {
          must: [
            { term: { trace_id: traceId } },
            { term: { project_id: projectId } },
          ],
        },
      },
      _source: ["indexing_md5s"],
    },
  });

  const existingTrace = existingTraceResponse.hits.hits[0]?._source;
  return existingTrace?.indexing_md5s;
};
