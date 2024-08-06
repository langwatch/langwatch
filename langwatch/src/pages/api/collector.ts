import * as Sentry from "@sentry/nextjs";
import crypto from "crypto";
import { type NextApiRequest, type NextApiResponse } from "next";
import type { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { dependencies } from "../../injection/dependencies.server";
import { getCurrentMonthMessagesCount } from "../../server/api/routers/limits";
import { maybeAddIdsToContextList } from "../../server/background/workers/collector/rag";
import {
  fetchExistingMD5s,
  scheduleTraceCollectionWithFallback,
} from "../../server/background/workers/collectorWorker";
import { prisma } from "../../server/db"; // Adjust the import based on your setup
import {
  type CollectorRESTParamsValidator,
  type CustomMetadata,
  type ReservedTraceMetadata,
  type Span,
} from "../../server/tracer/types";
import {
  collectorRESTParamsValidatorSchema,
  customMetadataSchema,
  reservedTraceMetadataSchema,
  spanSchema,
  spanValidatorSchema,
} from "../../server/tracer/types.generated";
import { getDebugger } from "../../utils/logger";

const debug = getDebugger("langwatch:collector");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const xAuthToken = req.headers["x-auth-token"];
  const authHeader = req.headers.authorization;

  const authToken =
    xAuthToken ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!authToken) {
    return res.status(401).json({
      message:
        "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
    });
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
    if ("labels" in req.body && req.body.labels) {
      req.body.metadata.labels = req.body.labels;
    }
  }

  // Allow objects and simple strings to be sent as labels as well
  if (req.body.metadata?.labels) {
    req.body.metadata.labels =
      typeof req.body.metadata.labels === "string"
        ? [req.body.metadata.labels]
        : Array.isArray(req.body.metadata.labels)
        ? req.body.metadata.labels
        : Object.entries(req.body.metadata.labels).map(
            ([key, value]) => `${key}: ${value as string}`
          );
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
    Sentry.captureException(new Error("ZodError on parsing body"), {
      extra: { projectId: project.id, body: req.body, zodError: error },
    });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  const { trace_id: nullableTraceId, expected_output: expectedOutput } = params;

  if (!req.body.spans) {
    return res.status(400).json({ message: "Missing 'spans' field" });
  }
  if (!Array.isArray(req.body.spans)) {
    return res
      .status(400)
      .json({ message: "Invalid 'spans' field, expecting array" });
  }

  let reservedTraceMetadata: ReservedTraceMetadata = {};
  let customMetadata: CustomMetadata = {};
  try {
    if (params.metadata) {
      reservedTraceMetadata = Object.fromEntries(
        Object.entries(
          reservedTraceMetadataSchema.parse(params.metadata)
        ).filter(([_key, value]) => value !== null && value !== undefined)
      );
      const remainingMetadata = Object.fromEntries(
        Object.entries(params.metadata).filter(
          ([key]) => !(key in reservedTraceMetadataSchema.shape)
        )
      );
      customMetadata = customMetadataSchema.parse(remainingMetadata);
    }
  } catch (error) {
    const validationError = fromZodError(error as ZodError);
    Sentry.captureException(new Error("ZodError on parsing metadata"), {
      extra: {
        projectId: project.id,
        metadata: params.metadata,
        zodError: error,
      },
    });
    return res.status(400).json({ error: validationError.message });
  }

  const spanFields = spanSchema.options.flatMap((option) =>
    Object.keys(option.shape)
  );
  const spans = (req.body as Record<string, any>).spans as Span[];
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
  if (traceIds[0] && (traceIds.length > 1 || traceIds[0] != traceId)) {
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
      Sentry.captureException(new Error("ZodError on parsing spans"), {
        extra: { projectId: project.id, span, zodError: error },
      });

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

  await scheduleTraceCollectionWithFallback({
    projectId: project.id,
    traceId,
    spans,
    reservedTraceMetadata,
    customMetadata,
    expectedOutput,
    existingTrace,
    paramsMD5,
  });

  return res.status(200).json({ message: "Trace received successfully." });
}
