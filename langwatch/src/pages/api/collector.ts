import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../server/db"; // Adjust the import based on your setup
import { SPAN_INDEX, TRACE_INDEX, esClient } from "../../server/elasticsearch";
import {
  type ElasticSearchInputOutput,
  type ElasticSearchSpan,
  type ErrorCapture,
  type Span,
  type SpanInput,
  type SpanOutput,
  type Trace,
} from "../../server/tracer/types";
import { spanValidatorSchema } from "../../server/tracer/types.generated";
import { getDebugger } from "../../utils/logger";
import * as Sentry from "@sentry/nextjs";

const debug = getDebugger("langwatch:collector");

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

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const sessionId = req.body.session_id;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const userId = req.body.user_id;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (!req.body.spans) {
    return res.status(400).json({ message: "Bad request" });
  }

  const spans = (req.body as Record<string, any>).spans as Span[];

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
  const traceId = traceIds[0];
  if (!traceId || traceIds.length > 1) {
    return res
      .status(400)
      .json({ message: "All spans must have the same trace id" });
  }

  debug(`collecting traceId ${traceId}`);

  for (const span of spans) {
    try {
      spanValidatorSchema.parse(span);
    } catch (error) {
      debug("Invalid span received", error, JSON.stringify(span, null, "  "));
      Sentry.captureException(error);
      return res.status(400).json({ error: "Invalid span format." });
    }
  }

  // Create the trace
  const trace: Trace = {
    id: traceId,
    project_id: project.id,
    session_id: sessionId, // Optional: This will be undefined if not sent
    user_id: userId, // Optional: This will be undefined if not sent
    timestamps: {
      started_at: Math.min(...spans.map((span) => span.timestamps.started_at)),
      inserted_at: Date.now(),
    },
    input: { value: getFirstInputAsText(spans) },
    output: { value: getLastOutputAsText(spans) },
    metrics: computeTraceMetrics(spans),
    error: getLastOutputError(spans),
  };

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

  return res.status(200).json({ message: "Traces received successfully." });
}

// TODO: test
const getFirstInputAsText = (spans: Span[]): string => {
  // TODO: shouldn't it be sorted by parent-child?
  const input = spans.filter((span) => span.input)[0]?.input;
  if (!input) {
    return "";
  }
  return typedValueToText(input);
};

// TODO: test
const getLastOutputAsText = (spans: Span[]): string => {
  // TODO: shouldn't it be sorted by parent-child?
  const spansWithOutputs = spans.filter((span) => span.outputs.length > 0);
  const outputs = spansWithOutputs[spansWithOutputs.length - 1]?.outputs;
  if (!outputs) {
    return "";
  }
  const firstOutput = outputs[0];
  if (!firstOutput) {
    return "";
  }

  return typedValueToText(firstOutput);
};

// TODO: test
const typedValueToText = (typed: SpanInput | SpanOutput): string => {
  if (typed.type == "text") {
    return typed.value;
  } else if (typed.type == "chat_messages") {
    const lastMessage = typed.value[typed.value.length - 1];
    return lastMessage
      ? lastMessage.content ?? JSON.stringify(lastMessage)
      : "";
  } else if (typed.type == "json") {
    try {
      const json = typed.value as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (json.text) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
        return json.text;
      }
      return JSON.stringify(typed.value);
    } catch (_e) {
      return typed.value?.toString() ?? "";
    }
  } else if (typed.type == "raw") {
    return typed.value;
  }

  return "";
};

const typedValueToElasticSearch = (
  typed: SpanInput | SpanOutput
): ElasticSearchInputOutput => {
  return {
    type: typed.type,
    value: JSON.stringify(typed.value),
  };
};

// TODO: test
const getLastOutputError = (spans: Span[]): ErrorCapture | null => {
  // TODO: shouldn't it be sorted by parent-child?
  const errorSpans = spans.filter((span) => span.error);
  const lastError = errorSpans[errorSpans.length - 1];
  if (!lastError) {
    return null;
  }
  return lastError.error ?? null;
};

// TODO: test
const computeTraceMetrics = (
  spans: Span[]
): {
  first_token_ms: number | null;
  total_time_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_cost: number | null;
} => {
  let earliestStartedAt: number | null = null;
  let latestFirstTokenAt: number | null = null;
  let latestFinishedAt: number | null = null;

  let totalPromptTokens: number | null = null;
  let totalCompletionTokens: number | null = null;

  spans.forEach((span) => {
    if (
      earliestStartedAt === null ||
      span.timestamps.started_at < earliestStartedAt
    ) {
      earliestStartedAt = span.timestamps.started_at;
    }

    if (
      span.timestamps.first_token_at &&
      (latestFirstTokenAt === null ||
        span.timestamps.first_token_at > latestFirstTokenAt)
    ) {
      latestFirstTokenAt = span.timestamps.first_token_at;
    }

    if (
      latestFinishedAt === null ||
      span.timestamps.finished_at > latestFinishedAt
    ) {
      latestFinishedAt = span.timestamps.finished_at;
    }

    if ("metrics" in span) {
      if (
        span.metrics.prompt_tokens !== undefined &&
        span.metrics.prompt_tokens !== null
      ) {
        if (!totalPromptTokens) {
          totalPromptTokens = 0;
        }
        totalPromptTokens += span.metrics.prompt_tokens;
      }
      if (
        span.metrics.completion_tokens !== undefined &&
        span.metrics.completion_tokens !== null
      ) {
        if (!totalCompletionTokens) {
          totalCompletionTokens = 0;
        }
        totalCompletionTokens += span.metrics.completion_tokens;
      }
    }
  });

  return {
    first_token_ms:
      latestFirstTokenAt && earliestStartedAt
        ? latestFirstTokenAt - earliestStartedAt
        : null,
    total_time_ms:
      latestFinishedAt && earliestStartedAt
        ? latestFinishedAt - earliestStartedAt
        : null,
    prompt_tokens: totalPromptTokens,
    completion_tokens: totalCompletionTokens,
    total_cost: null,
  };
};
