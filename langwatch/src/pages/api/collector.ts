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
  type ElasticSearchTrace,
  type ErrorCapture,
  type Span,
  type SpanInputOutput,
  type Trace,
} from "../../server/tracer/types";
import {
  collectorRESTParamsValidatorSchema,
  spanSchema,
  spanValidatorSchema,
} from "../../server/tracer/types.generated";
import { getDebugger } from "../../utils/logger";
import {
  addInputAndOutputForRAGs,
  maybeAddIdsToContextList,
} from "./collector/rag";
import { getTraceInput, getTraceOutput } from "./collector/trace";
import {
  addGuardrailCosts,
  addLLMTokensCount,
  computeTraceMetrics,
} from "./collector/metrics";
import { scheduleTraceChecks } from "./collector/traceChecks";
import { scoreSatisfactionFromInput } from "./collector/satisfaction";
import crypto from "crypto";
import type { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { env } from "../../env.mjs";
import { cleanupPIIs } from "./collector/piiCheck";
import { getCurrentMonthMessagesCount } from "../../server/api/routers/limits";
import { dependencies } from "../../injection/dependencies.server";

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

  if (
    req.headers["content-type"] !== "application/json" ||
    typeof req.body !== "object"
  ) {
    return res.status(400).json({ message: "Invalid body, expecting json" });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
    include: {
      team: true,
    },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  const currentMonthMessagesCount = await getCurrentMonthMessagesCount([
    project.id,
  ]);
  const activePlan = await dependencies.subscriptionHandler.getActivePlan(
    project.team.organizationId
  );
  if (currentMonthMessagesCount >= activePlan.maxMessagesPerMonth) {
    return res.status(429).json({
      message: `ERR_PLAN_LIMIT: You have reached the monthly limit of ${activePlan.maxMessagesPerMonth} messages, please go to LangWatch dashboard to verify your plan.`,
    });
  }

  // We migrated those keys to inside metadata, but we still want to support them for retrocompatibility for a while
  if (!("metadata" in req.body) || !req.body.metadata) {
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
      JSON.stringify(req.body, null, "  "),
      { projectId: project.id }
    );
    Sentry.captureException(error, { extra: { projectId: project.id } });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  const { trace_id: nullableTraceId, expected_output: expectedOutput } = params;
  const {
    thread_id: threadId,
    user_id: userId,
    customer_id: customerId,
    sdk_version: sdkVersion,
    sdk_language: sdkLanguage,
    labels,
  } = params.metadata ?? {};

  if (!req.body.spans) {
    return res.status(400).json({ message: "Missing 'spans' field" });
  }
  if (!Array.isArray(req.body.spans)) {
    return res
      .status(400)
      .json({ message: "Invalid 'spans' field, expecting array" });
  }

  const spanFields = spanSchema.options.flatMap((option) =>
    Object.keys(option.shape)
  );
  let spans = (req.body as Record<string, any>).spans as Span[];
  spans.forEach((span) => {
    // We changed "id" to "span_id", but we still want to support "id" for retrocompatibility for a while
    if ("id" in span) {
      span.span_id = span.id as string;
    }
    if (nullableTraceId && !span.trace_id) {
      span.trace_id = nullableTraceId;
    }
    // We changes "outputs" list to "output" single item, so here we keep supporting the old "outputs" for retrocompaibility
    if (
      typeof span.output === "undefined" &&
      "outputs" in span &&
      typeof span.outputs !== "undefined"
    ) {
      //@ts-ignore
      if (span.outputs.length == 0) {
        span.output = null;
        //@ts-ignore
      } else if (span.outputs.length == 1) {
        //@ts-ignore
        span.output = span.outputs[0];
        //@ts-ignore
      } else if (span.outputs.length > 1) {
        span.output = {
          type: "list",
          //@ts-ignore
          value: span.outputs,
        };
      }
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
        content:
          typeof context.content === "string"
            ? context.content
            : JSON.stringify(context.content),
      }));
    }
    if (span.error) {
      span.error.has_error = true;
    }

    for (const key of Object.keys(span)) {
      if (!spanFields.includes(key)) {
        delete (span as any)[key];
      }
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

  for (const [index, span] of spans.entries()) {
    try {
      spanValidatorSchema.parse(span);
    } catch (error) {
      debug("Invalid span received", error, JSON.stringify(span, null, "  "), {
        projectId: project.id,
      });
      Sentry.captureException(error, { extra: { projectId: project.id } });

      const validationError = fromZodError(error as ZodError);
      return res
        .status(400)
        .json({ error: validationError.message + ` at "spans[${index}]"` });
    }

    if (
      (span.timestamps.started_at &&
        span.timestamps.started_at.toString().length === 10) ||
      (span.timestamps.finished_at &&
        span.timestamps.finished_at.toString().length === 10) ||
      (span.timestamps.first_token_at &&
        span.timestamps.first_token_at.toString().length === 10)
    ) {
      debug(
        "Timestamps not in milliseconds for",
        traceId,
        "on project",
        project.id
      );
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
  const existingTrace = await fetchExistingMD5s(traceId, project.id);
  if (existingTrace?.indexing_md5s?.includes(paramsMD5)) {
    return res.status(200).json({ message: "No changes" });
  }

  debug(`collecting traceId ${traceId}`);

  spans = addInputAndOutputForRAGs(
    await addLLMTokensCount(addGuardrailCosts(spans))
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

  const nullToUndefined = <T>(value: T | null): T | undefined =>
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    value === null ? undefined : value;

  // Create the trace
  const trace: ElasticSearchTrace = {
    trace_id: traceId,
    project_id: project.id,
    metadata: {
      thread_id: nullToUndefined(threadId), // Optional: This will be undefined if not sent
      user_id: nullToUndefined(userId), // Optional: This will be undefined if not sent
      customer_id: nullToUndefined(customerId),
      labels: nullToUndefined(labels),
      sdk_version: nullToUndefined(sdkVersion),
      sdk_language: nullToUndefined(sdkLanguage),
    },
    timestamps: {
      started_at: Math.min(...spans.map((span) => span.timestamps.started_at)),
      inserted_at: Date.now(),
      updated_at: Date.now(),
    },
    input,
    output,
    expected_output: expectedOutput ? { value: expectedOutput } : undefined,
    metrics: computeTraceMetrics(spans),
    error,
    indexing_md5s: [...(existingTrace?.indexing_md5s ?? []), paramsMD5],
  };

  const piiEnforced = env.NODE_ENV === "production";
  await cleanupPIIs(trace, esSpans, project.piiRedactionLevel, piiEnforced);

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

  // Does not re-schedule trace checks for too old traces being resynced
  if (!existingTrace || existingTrace.inserted_at > Date.now() - 30 * 1000) {
    void scheduleTraceChecks(trace, spans);
  }

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

const fetchExistingMD5s = async (
  traceId: string,
  projectId: string
): Promise<
  { indexing_md5s: Trace["indexing_md5s"]; inserted_at: number } | undefined
> => {
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
      _source: ["indexing_md5s", "timestamps.inserted_at"],
    },
  });

  const existingTrace = existingTraceResponse.hits.hits[0]?._source;
  if (!existingTrace) {
    return undefined;
  }

  return {
    indexing_md5s: existingTrace.indexing_md5s,
    inserted_at: existingTrace.timestamps.inserted_at,
  };
};
