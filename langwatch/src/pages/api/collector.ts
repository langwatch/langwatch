import superjson from "superjson";
import crypto from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import type { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { captureException, getCurrentScope } from "~/utils/posthogErrorCapture";
import { notifyPlanLimitReached } from "../../../ee/billing";
import { withPagesRouterLogger } from "../../middleware/pages-router-logger";
import { withPagesRouterTracer } from "../../middleware/pages-router-tracer";
import { maybeAddIdsToContextList } from "../../server/background/workers/collector/rag";
import {
  fetchExistingMD5s,
  scheduleTraceCollectionWithFallback,
} from "../../server/background/workers/collectorWorker";
import { prisma } from "../../server/db";
import type {
  CollectorRESTParamsValidator,
  CustomMetadata,
  ReservedTraceMetadata,
  Span,
} from "../../server/tracer/types";
import {
  collectorRESTParamsValidatorSchema,
  customMetadataSchema,
  reservedTraceMetadataSchema,
  spanMetricsSchema,
  spanSchema,
  spanValidatorSchema,
} from "../../server/tracer/types.generated";
import { getApp } from "../../server/app-layer/app";
import { SubscriptionHandler } from "../../server/subscriptionHandler";
import { createLogger } from "../../utils/logger/server";

const logger = createLogger("langwatch.collector");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
};

async function handleCollectorRequest(
  req: NextApiRequest,
  res: NextApiResponse,
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
    logger.warn(
      "collector request is not authenticated, no auth token provided",
    );

    return res.status(401).json({
      message:
        "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
    });
  }

  if (
    req.headers["content-type"] !== "application/json" ||
    typeof req.body !== "object"
  ) {
    logger.error("collector request body is not json");

    return res.status(400).json({ message: "Invalid body, expecting json" });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string, archivedAt: null },
    include: {
      team: true,
    },
  });

  if (!project) {
    logger.warn("collector request is not authenticated, invalid auth token");

    return res.status(401).json({ message: "Invalid auth token." });
  }

  logger.info({ projectId: project.id }, "collector request being processed");

  try {
    const limitResult = await getApp().usage.checkLimit({
      teamId: project.teamId,
    });

    if (limitResult.exceeded) {
      try {
        const activePlan = await SubscriptionHandler.getActivePlan(
          project.team.organizationId,
        );
        await notifyPlanLimitReached({
          organizationId: project.team.organizationId,
          planName: activePlan.name ?? "free",
        });
      } catch (error) {
        logger.error(
          { error, projectId: project.id },
          "Error sending plan limit notification",
        );
      }
      logger.info(
        {
          projectId: project.id,
          currentMonthMessagesCount: limitResult.count,
          activePlanName: limitResult.planName,
          maxMessagesPerMonth: limitResult.maxMessagesPerMonth,
        },
        "Project has reached plan limit",
      );

      return res.status(429).json({
        message: `ERR_PLAN_LIMIT: ${limitResult.message}`,
      });
    }
  } catch (error) {
    logger.error(
      { error, projectId: project.id },
      "Error checking trace limit",
    );
    captureException(new Error("Error checking trace limit"), {
      extra: { projectId: project.id, error },
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
              ([key, value]) => `${key}: ${value as string}`,
            );
  }

  for (const evaluation of req.body.evaluations ?? []) {
    if (
      evaluation.status !== "error" &&
      evaluation.status !== "skipped" &&
      (evaluation.passed === undefined || evaluation.passed === null) &&
      (evaluation.score === undefined || evaluation.score === null) &&
      (evaluation.label === undefined || evaluation.label === null)
    ) {
      logger.error(
        { projectId: project.id, evaluationId: evaluation.id },
        "evaluation has no passed, score or label",
      );

      return res.status(400).json({
        error:
          "Either `passed`, `score` or `label` field must be defined for evaluations",
      });
    }

    if (evaluation.error) {
      evaluation.error.has_error = true;
    }

    if (
      (evaluation.timestamps?.started_at &&
        evaluation.timestamps.started_at.toString().length !== 13) ||
      (evaluation.timestamps?.finished_at &&
        evaluation.timestamps.finished_at.toString().length !== 13)
    ) {
      logger.error(
        { projectId: project.id, evaluationId: evaluation.id },
        "evaluation timestamps not in milliseconds",
      );

      return res.status(400).json({
        error:
          "Evaluation timestamps should be in milliseconds not in seconds, please multiply it by 1000",
      });
    }
  }

  let params: CollectorRESTParamsValidator;
  try {
    params = collectorRESTParamsValidatorSchema.parse(req.body);
  } catch (error) {
    captureException(new Error("ZodError on parsing body"), {
      extra: { projectId: project.id, body: req.body, zodError: error },
    });

    const validationError = fromZodError(error as ZodError);

    logger.error(
      { error, body: req.body, validationError },
      "invalid trace received",
    );

    return res.status(400).json({ error: validationError.message });
  }

  const { trace_id: nullableTraceId, expected_output: expectedOutput } = params;

  if (req.body.spans && !Array.isArray(req.body.spans)) {
    logger.error(
      {
        projectId: project.id,
        spans: req.body.spans,
        traceId: nullableTraceId,
      },
      "invalid spans field, expecting array",
    );

    return res
      .status(400)
      .json({ message: "Invalid 'spans' field, expecting array" });
  }

  if (req.body.spans?.length > 200) {
    logger.info(
      {
        projectId: project.id,
        spansCount: req.body.spans?.length,
        traceId: nullableTraceId,
      },
      "[429] Too many spans",
    );
    return res.status(429).json({
      message: "Too many spans, maximum of 200 per trace",
    });
  }

  let reservedTraceMetadata: ReservedTraceMetadata = {};
  let customMetadata: CustomMetadata = {};
  try {
    if (params.metadata) {
      reservedTraceMetadata = Object.fromEntries(
        Object.entries(
          reservedTraceMetadataSchema.parse(params.metadata),
        ).filter(([_key, value]) => value !== null && value !== undefined),
      );
      const remainingMetadata = Object.fromEntries(
        Object.entries(params.metadata).filter(
          ([key]) => !(key in reservedTraceMetadataSchema.shape),
        ),
      );
      customMetadata = customMetadataSchema.parse(remainingMetadata);
    }
  } catch (error) {
    const validationError = fromZodError(error as ZodError);
    captureException(new Error("ZodError on parsing metadata"), {
      extra: {
        projectId: project.id,
        metadata: params.metadata,
        zodError: error,
      },
    });

    logger.error(
      {
        projectId: project.id,
        metadata: params.metadata,
        zodError: error,
      },
      "invalid metadata received",
    );

    return res.status(400).json({ error: validationError.message });
  }

  const spanFields = spanSchema.options.flatMap((option) =>
    Object.keys(option.shape),
  );
  const spans = ((req.body as Record<string, any>).spans ?? []) as Span[];
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
    logger.error(
      {
        projectId: project.id,
        traceId: nullableTraceId,
        spanCount: spans.length,
        spanIds: spans.map((span) => span.span_id),
      },
      "trace id not defined",
    );

    return res.status(400).json({ message: "Trace ID not defined" });
  }

  getCurrentScope()?.setPropagationContext?.({
    traceId,
    sampleRand: 1,
    propagationSpanId: traceId,
  });

  const traceIds = Array.from(
    new Set(spans.filter((span) => span.trace_id).map((span) => span.trace_id)),
  );
  if (traceIds[0] && (traceIds.length > 1 || traceIds[0] != traceId)) {
    logger.error(
      { projectId: project.id, traceId, traceIds },
      "trace ids are not the same",
    );

    return res
      .status(400)
      .json({ message: "All spans must have the same trace id" });
  }

  for (const [index, span] of spans.entries()) {
    // Move extrataneous metrics to params for retrocompatibility
    if (span.metrics) {
      const validMetrics = spanMetricsSchema.safeParse(span.metrics);
      if (validMetrics.success) {
        const extrataneousMetrics = Object.fromEntries(
          Object.entries(span.metrics).filter(
            ([key]) => !(key in validMetrics.data),
          ),
        );
        span.params = {
          ...span.params,
          ...extrataneousMetrics,
        };
        span.metrics = validMetrics.data;
      }
    }
    try {
      spans[index] = spanValidatorSchema.parse(span);
    } catch (error) {
      captureException(new Error("ZodError on parsing spans"), {
        extra: { projectId: project.id, span, zodError: error },
      });

      const validationError = fromZodError(error as ZodError);

      logger.error(
        { error, span, projectId: project.id, index, validationError },
        "invalid span received",
      );

      return res.status(400).json({
        error: validationError.message + ` at "spans[${index}]"`,
      });
    }

    if (
      (span.timestamps.started_at &&
        span.timestamps.started_at.toString().length !== 13) ||
      (span.timestamps.finished_at &&
        span.timestamps.finished_at.toString().length !== 13) ||
      (span.timestamps.first_token_at &&
        span.timestamps.first_token_at.toString().length !== 13)
    ) {
      logger.error(
        { traceId, projectId: project.id },
        "timestamps not in milliseconds for span",
      );
      return res.status(400).json({
        error:
          "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
      });
    }
  }

  const paramsMD5 = crypto
    .createHash("md5")
    .update(superjson.stringify({ ...params, spans }))
    .digest("hex");
  const existingTrace = await fetchExistingMD5s(traceId, project.id);
  if (existingTrace?.indexing_md5s?.includes(paramsMD5)) {
    logger.info(
      { traceId, projectId: project.id, paramsMD5 },
      "trace already indexed",
    );

    return res.status(200).json({ message: "No changes" });
  }

  if (existingTrace?.version && existingTrace.version > 256) {
    logger.error(
      { traceId, projectId: project.id, version: existingTrace.version },
      "over 256 updates were sent for this trace already, no more updates will be accepted",
    );

    return res.status(400).json({
      message:
        "Over 256 updates were sent for this trace already, no more updates will be accepted",
    });
  }
  if (existingTrace?.existing_metadata?.custom) {
    customMetadata = {
      ...existingTrace.existing_metadata.custom,
      ...customMetadata,
    };
  }

  const forceSync = req.query.force_sync === "true";
  const contentLength = req.headers["content-length"];
  await scheduleTraceCollectionWithFallback(
    {
      projectId: project.id,
      traceId,
      spans,
      evaluations: params.evaluations,
      reservedTraceMetadata,
      customMetadata,
      expectedOutput,
      existingTrace,
      paramsMD5,
      collectedAt: Date.now(),
    },
    forceSync,
    contentLength ? parseInt(contentLength as string, 10) : undefined,
  );

  return res.status(200).json({ message: "Trace received successfully." });
}

// Export the handler wrapped with logging middleware
export default withPagesRouterTracer("langwatch.collector")(
  withPagesRouterLogger(handleCollectorRequest),
);
