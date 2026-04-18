import crypto from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import superjson from "superjson";
import type { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { loggerMiddleware } from "../../app/api/middleware/logger";
import { tracerMiddleware } from "../../app/api/middleware/tracer";
import { captureException, getCurrentScope } from "../../utils/posthogErrorCapture";
import { getApp } from "../app-layer/app";
import { evaluationNameAutoslug } from "../background/workers/collector/evaluationNameAutoslug";
import { maybeAddIdsToContextList } from "../background/workers/collector/rag";
import { fetchExistingMD5s } from "../background/workers/collectorWorker";
import { prisma } from "../db";
import type {
  CollectorRESTParamsValidator,
  CustomMetadata,
  ReservedTraceMetadata,
  Span,
} from "../tracer/types";
import {
  collectorRESTParamsValidatorSchema,
  customMetadataSchema,
  reservedTraceMetadataSchema,
  spanMetricsSchema,
  spanSchema,
  spanValidatorSchema,
} from "../tracer/types.generated";
import { CollectorSpanUtils } from "../traces/collectorSpan.utils";
import { createLogger } from "../../utils/logger/server";
import { TokenResolver } from "../pat/token-resolver";
import { enforcePatCeiling, extractCredentials } from "../pat/auth-middleware";

const logger = createLogger("langwatch.collector");
const tokenResolver = TokenResolver.create(prisma);

export const app = new Hono().basePath("/api");

// Middleware
app.use(tracerMiddleware({ name: "langwatch.collector" }));
app.use(loggerMiddleware());

// POST /api/collector
app.post(
  "/collector",
  bodyLimit({ maxSize: 10 * 1024 * 1024 }), // 10MB
  async (c) => {
    const credentials = extractCredentials(c);

    if (!credentials) {
      logger.warn(
        "collector request is not authenticated, no auth token provided",
      );

      return c.json(
        {
          message:
            "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
        },
        401,
      );
    }

    const contentType = c.req.header("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      logger.error("collector request body is not json");

      return c.json({ message: "Invalid body, expecting json" }, 400);
    }

    let body: Record<string, any>;
    try {
      body = await c.req.json();
    } catch {
      logger.error("collector request body is not valid json");
      return c.json({ message: "Invalid body, expecting json" }, 400);
    }

    if (typeof body !== "object") {
      logger.error("collector request body is not json");
      return c.json({ message: "Invalid body, expecting json" }, 400);
    }

    const resolved = await tokenResolver.resolve({
      token: credentials.token,
      projectId: credentials.projectId,
    });

    if (!resolved) {
      logger.warn(
        "collector request is not authenticated, invalid auth token",
      );

      return c.json({ message: "Invalid auth token." }, 401);
    }

    // Enforce PAT ceiling (legacy tokens bypass). `traces:create` gates write
    // access — ADMIN and MEMBER have it; VIEWER does not, preventing
    // read-only PATs from ingesting traces.
    const denial = await enforcePatCeiling({
      prisma,
      resolved,
      permission: "traces:create",
    });
    if (denial) {
      logger.warn(
        { projectId: resolved.project.id, patId: resolved.type === "pat" ? resolved.patId : undefined },
        "collector request denied by PAT ceiling",
      );
      return c.json({ message: denial.error }, denial.status);
    }

    const project = resolved.project;

    logger.info(
      { projectId: project.id },
      "collector request being processed",
    );

    try {
      const limitResult = await getApp().usage.checkLimit({
        teamId: project.teamId,
      });

      if (limitResult.exceeded) {
        try {
          const activePlan = await getApp().planProvider.getActivePlan({
            organizationId: project.team.organizationId,
          });
          await getApp().usageLimits.notifyPlanLimitReached({
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

        return c.json(
          {
            message: `ERR_PLAN_LIMIT: ${limitResult.message}`,
          },
          429,
        );
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
    if (!("metadata" in body) || !body.metadata) {
      body.metadata = {};
      if ("thread_id" in body) {
        body.metadata.thread_id = body.thread_id;
      }
      if ("user_id" in body) {
        body.metadata.user_id = body.user_id;
      }
      if ("customer_id" in body) {
        body.metadata.customer_id = body.customer_id;
      }
      if ("labels" in body && body.labels) {
        body.metadata.labels = body.labels;
      }
    }

    // Allow objects and simple strings to be sent as labels as well
    if (body.metadata?.labels) {
      body.metadata.labels =
        typeof body.metadata.labels === "string"
          ? [body.metadata.labels]
          : Array.isArray(body.metadata.labels)
            ? body.metadata.labels
            : Object.entries(body.metadata.labels).map(
                ([key, value]) => `${key}: ${value as string}`,
              );
    }

    for (const evaluation of body.evaluations ?? []) {
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

        return c.json(
          {
            error:
              "Either `passed`, `score` or `label` field must be defined for evaluations",
          },
          400,
        );
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

        return c.json(
          {
            error:
              "Evaluation timestamps should be in milliseconds not in seconds, please multiply it by 1000",
          },
          400,
        );
      }
    }

    let params: CollectorRESTParamsValidator;
    try {
      params = collectorRESTParamsValidatorSchema.parse(body);
    } catch (error) {
      captureException(new Error("ZodError on parsing body"), {
        extra: { projectId: project.id, body, zodError: error },
      });

      const validationError = fromZodError(error as ZodError);

      logger.error(
        { error, body, validationError },
        "invalid trace received",
      );

      return c.json({ error: validationError.message }, 400);
    }

    // Body successfully validated — mark PAT as used if this request was
    // authenticated via PAT
    if (resolved.type === "pat") {
      tokenResolver.markUsed({ patId: resolved.patId });
    }

    const { trace_id: nullableTraceId, expected_output: expectedOutput } =
      params;

    if (body.spans && !Array.isArray(body.spans)) {
      logger.error(
        {
          projectId: project.id,
          spans: body.spans,
          traceId: nullableTraceId,
        },
        "invalid spans field, expecting array",
      );

      return c.json(
        { message: "Invalid 'spans' field, expecting array" },
        400,
      );
    }

    if (body.spans?.length > 200) {
      logger.info(
        {
          projectId: project.id,
          spansCount: body.spans?.length,
          traceId: nullableTraceId,
        },
        "[429] Too many spans",
      );
      return c.json(
        {
          message: "Too many spans, maximum of 200 per trace",
        },
        429,
      );
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

      return c.json({ error: validationError.message }, 400);
    }

    const spanFields = spanSchema.options.flatMap((option) =>
      Object.keys(option.shape),
    );
    const spans = ((body as Record<string, any>).spans ?? []) as Span[];
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
        //@ts-expect-error
        if (span.outputs.length == 0) {
          span.output = null;
          //@ts-expect-error
        } else if (span.outputs.length == 1) {
          //@ts-expect-error
          span.output = span.outputs[0];
          //@ts-expect-error
        } else if (span.outputs.length > 1) {
          span.output = {
            type: "list",
            //@ts-expect-error
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

      return c.json({ message: "Trace ID not defined" }, 400);
    }

    getCurrentScope()?.setPropagationContext?.({
      traceId,
      sampleRand: 1,
      propagationSpanId: traceId,
    });

    const traceIds = Array.from(
      new Set(
        spans.filter((span) => span.trace_id).map((span) => span.trace_id),
      ),
    );
    if (traceIds[0] && (traceIds.length > 1 || traceIds[0] != traceId)) {
      logger.error(
        { projectId: project.id, traceId, traceIds },
        "trace ids are not the same",
      );

      return c.json(
        { message: "All spans must have the same trace id" },
        400,
      );
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

        return c.json(
          {
            error: validationError.message + ` at "spans[${index}]"`,
          },
          400,
        );
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
        return c.json(
          {
            error:
              "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
          },
          400,
        );
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

      return c.json({
        message: "No changes",
        partialSuccess: { rejectedSpans: 0, errorMessage: "" },
      });
    }

    if (existingTrace?.version && existingTrace.version > 256) {
      logger.error(
        { traceId, projectId: project.id, version: existingTrace.version },
        "over 256 updates were sent for this trace already, no more updates will be accepted",
      );

      return c.json(
        {
          message:
            "Over 256 updates were sent for this trace already, no more updates will be accepted",
        },
        400,
      );
    }
    if (existingTrace?.existing_metadata?.custom) {
      customMetadata = {
        ...existingTrace.existing_metadata.custom,
        ...customMetadata,
      };
    }

    let rejectedSpans = 0;
    let rejectionErrors: string[] = [];
    try {
      const resource = CollectorSpanUtils.buildResource({
        reservedTraceMetadata,
        customMetadata,
        expectedOutput,
      });

      const results = await Promise.allSettled(
        spans.map((span) =>
          getApp().traces.recordSpan({
            tenantId: project.id,
            span: CollectorSpanUtils.convertSpanToOtlp(span),
            resource,
            instrumentationScope: { name: "langwatch.rest.collector" },
            piiRedactionLevel: project.piiRedactionLevel,
            occurredAt: Date.now(),
          }),
        ),
      );

      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      rejectedSpans = failures.length;
      rejectionErrors = failures.map((f) =>
        f.reason instanceof Error ? f.reason.message : String(f.reason),
      );
      if (failures.length > 0) {
        logger.error(
          {
            projectId: project.id,
            traceId,
            failureCount: failures.length,
            errors: failures.map((f) => f.reason),
          },
          "Error dispatching collector spans to event sourcing",
        );
      }
    } catch (error) {
      // Catch synchronous errors (e.g., from buildResource)
      rejectedSpans = spans.length;
      rejectionErrors = [
        error instanceof Error ? error.message : String(error),
      ];
      logger.error(
        { error, projectId: project.id, traceId },
        "Error initializing event sourcing dispatch",
      );
    }

    // Dispatch custom SDK evaluations to the event-sourcing evaluation pipeline.
    // The REST collector receives evaluations as a separate field (not as span events),
    // so they must be dispatched independently from the spans above.
    if (
      params.evaluations &&
      params.evaluations.length > 0 &&
      traceId
    ) {
      try {
        const app = getApp();
        const occurredAt = Date.now();

        for (const evaluation of params.evaluations) {
          const evaluationMD5 = crypto
            .createHash("md5")
            .update(JSON.stringify({ traceId, evaluation }))
            .digest("hex");
          const evaluationId =
            evaluation.evaluation_id ?? `eval_md5_${evaluationMD5}`;
          const evaluatorId =
            evaluation.evaluator_id ??
            evaluationNameAutoslug(evaluation.name);
          const status =
            evaluation.status ??
            (evaluation.error ? "error" : "processed");

          await app.evaluations.reportEvaluation({
            tenantId: project.id,
            evaluationId,
            evaluatorId,
            evaluatorType: "custom",
            evaluatorName: evaluation.name,
            traceId,
            isGuardrail: evaluation.is_guardrail ?? undefined,
            status,
            score: evaluation.score ?? null,
            passed: evaluation.passed ?? null,
            label: evaluation.label ?? null,
            details: evaluation.details ?? null,
            error: evaluation.error?.message ?? null,
            occurredAt,
          });
        }
      } catch (error) {
        logger.error(
          { error, projectId: project.id, traceId },
          "Error dispatching REST evaluations to event sourcing",
        );
      }
    }

    return c.json({
      message: "Trace received successfully.",
      partialSuccess: {
        rejectedSpans,
        errorMessage: rejectionErrors.join("; "),
      },
    });
  },
);
