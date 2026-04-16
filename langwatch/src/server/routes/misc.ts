/**
 * Hono routes for miscellaneous API endpoints.
 *
 * Replaces:
 * - src/pages/api/analytics.ts
 * - src/pages/api/demo/hotel_bot.ts
 * - src/pages/api/dspy/log_steps.ts
 * - src/pages/api/experiment/init.ts
 * - src/pages/api/mcp/authorize.ts
 * - src/pages/api/optimization/[...params].ts
 * - src/pages/api/rerun_checks.ts
 * - src/pages/api/start_workers.ts
 * - src/pages/api/track_event.ts
 * - src/pages/api/track_usage.ts
 * - src/pages/api/trigger/slack.ts
 * - src/pages/api/webhooks/stripe.ts
 */
import { generate } from "@langwatch/ksuid";
import { AlertType, ExperimentType, TriggerAction } from "@prisma/client";
import type { Project } from "@prisma/client";
import { SpanStatusCode } from "@opentelemetry/api";
import { ESpanKind } from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
import { OpenAI } from "openai";
import { nanoid } from "nanoid";
import { randomUUID, createHash } from "node:crypto";
import crypto from "crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type ZodError, z } from "zod";
import { fromZodError } from "zod-validation-error";
import { TRPCError } from "@trpc/server";
import { env } from "~/env.mjs";
import { getApp } from "~/server/app-layer/app";
import type { DspyStepData } from "~/server/app-layer/dspy-steps/types";
import { getAnalyticsService } from "~/server/analytics/analytics.service";
import {
  type TimeseriesInputType,
  timeseriesSeriesInput,
} from "~/server/analytics/registry";
import { sharedFiltersInputSchema } from "~/server/analytics/types";
import { start } from "~/server/background/worker";
import {
  estimateCost,
  matchModelCostWithFallbacks,
} from "~/server/background/workers/collector/cost";
import { prisma } from "~/server/db";
import type {
  DSPyLLMCall,
  DSPyStepRESTParams,
} from "~/server/experiments/types";
import { dSPyStepRESTParamsSchema } from "~/server/experiments/types.generated";
import { filterFieldsEnum } from "~/server/filters/types";
import { createLicenseEnforcementService } from "~/server/license-enforcement";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { buildResourceLimitMessage } from "~/server/license-enforcement/limit-message";
import {
  getLLMModelCosts,
  type MaybeStoredLLMModelCost,
} from "~/server/modelProviders/llmModelCost";
import { getPayloadSizeHistogram } from "~/server/metrics";
import { getPostHogInstance } from "~/server/posthog";
import { getServerAuthSession } from "~/server/auth";
import { connection as redis } from "~/server/redis";
import { TRACK_EVENT_SPAN_NAME } from "~/server/tracer/constants";
import type { TrackEventRESTParamsValidator } from "~/server/tracer/types";
import { trackEventRESTParamsValidatorSchema } from "~/server/tracer/types.generated";
import {
  TRACK_EVENTS_QUEUE,
  trackEventsQueue,
} from "~/server/background/queues/trackEventsQueue";
import { runWorkflow as runWorkflowFn } from "~/server/workflows/runWorkflow";
import { createStripeWebhookHandler } from "../../../ee/billing";
import { KSUID_RESOURCES } from "~/utils/constants";
import { encrypt } from "~/utils/encryption";
import { slugify } from "~/utils/slugify";
import { captureException } from "~/utils/posthogErrorCapture";
import { createLogger } from "~/utils/logger/server";
import { findOrCreateExperiment } from "~/pages/api/experiment/init";

const logger = createLogger("langwatch:misc");

export const app = new Hono().basePath("/api");

// =============================================
// POST /api/analytics
// =============================================
app.post("/analytics", async (c) => {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Bad request" }, 400);
  }

  const input = body;
  input.projectId = project.id;

  let params: TimeseriesInputType;
  try {
    params = sharedFiltersInputSchema
      .extend(timeseriesSeriesInput.shape)
      .parse(input);
  } catch (error) {
    const validationError = fromZodError(error as ZodError);
    return c.json({ error: validationError.message }, 400);
  }

  try {
    const analyticsService = getAnalyticsService();
    const timeseriesResult = await analyticsService.getTimeseries(params);
    return c.json(timeseriesResult);
  } catch (e) {
    if (e instanceof TRPCError && e.code === "BAD_REQUEST") {
      return c.json({ code: e.code, message: e.message }, 400);
    } else {
      throw e;
    }
  }
});

// =============================================
// POST /api/demo/hotel_bot
// =============================================
const hotelBotOpenai = new OpenAI({
  apiKey: env.OPENAI_API_KEY ?? "bogus",
});

const guestQueries = [
  "Room Assistance",
  "Dining Recommendations and Reservations",
  "Transportation Services",
  "Local Area Information",
  "Special Requests",
  "Technical Support",
  "Housekeeping Services",
  "Billing and Check-out Assistance",
];

const HOTEL_SYSTEM_PROMPT =
  "Imagine you're in a bustling hotel lobby, serving as the knowledgeable and friendly concierge. You're the go-to person for guests seeking recommendations, assistance with reservations, or information about local attractions. How would you welcome guests and ensure their stay is memorable? Think about how you'd provide personalized recommendations, handle inquiries efficiently, and maintain a professional yet friendly demeanor.";

const RAG_SYSTEM_PROMPT =
  "You are a restaurant expert knowing the best around town.";

app.post("/demo/hotel_bot", async (c) => {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const randomNumberTry = Math.floor(Math.random() * 10);
  if (randomNumberTry % 2 === 0) {
    return c.json({ message: "Not this time" }, 401);
  }

  const randomNumber = Math.floor(Math.random() * 10);

  if (randomNumber % 2 === 0) {
    try {
      const ragResponse = await ragMessage(authToken as string);
      return c.json({ message: "Sent to LangWatch", ragResponse });
    } catch (error: any) {
      return c.json({ message: "Error", error }, 500);
    }
  } else {
    try {
      const threadId = `thread_${nanoid()}`;
      const userId = `user_${nanoid()}`;
      const userInput = (await getInitialMessage()) ?? "";

      const assistantResponse = await firstChatMessage(
        userInput,
        threadId,
        userId,
        authToken as string,
      );
      const expectedUserResponse = await userResponse(
        userInput,
        assistantResponse ?? "",
      );
      await secondChatMessage(
        userInput,
        assistantResponse ?? "",
        expectedUserResponse ?? "",
        threadId,
        userId,
        authToken as string,
      );

      return c.json({ message: "Sent to LangWatch" });
    } catch (error: any) {
      return c.json({ message: "Error", error }, 500);
    }
  }
});

// =============================================
// POST /api/dspy/log_steps
// =============================================
app.post(
  "/dspy/log_steps",
  bodyLimit({ maxSize: 20 * 1024 * 1024 }),
  async (c) => {
    const authToken = c.req.header("x-auth-token");
    if (!authToken) {
      return c.json({ message: "X-Auth-Token header is required." }, 401);
    }

    const project = await prisma.project.findUnique({
      where: { apiKey: authToken },
    });
    if (!project) {
      return c.json({ message: "Invalid auth token." }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ message: "Bad request" }, 400);
    }

    const payloadSize = JSON.stringify(body).length;
    const payloadSizeMB = payloadSize / (1024 * 1024);
    getPayloadSizeHistogram("log_steps").observe(payloadSize);

    logger.info(
      {
        payloadSize,
        payloadSizeMB: payloadSizeMB.toFixed(2),
        projectId: project.id,
      },
      "DSPy log_steps request received",
    );

    let params: DSPyStepRESTParams[];
    try {
      params = z.array(dSPyStepRESTParamsSchema).parse(body);
    } catch (error) {
      logger.error(
        {
          error,
          payloadSize,
          payloadSizeMB: payloadSizeMB.toFixed(2),
          projectId: project.id,
        },
        "invalid log_steps data received",
      );
      captureException(error, { extra: { projectId: project.id } });
      const validationError = fromZodError(error as ZodError);
      return c.json({ error: validationError.message }, 400);
    }

    for (const param of params) {
      if (
        param.timestamps.created_at &&
        param.timestamps.created_at.toString().length === 10
      ) {
        logger.error(
          { param, projectId: project.id },
          "timestamps not in milliseconds for step",
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

    logger.info(
      { stepCount: params.length, projectId: project.id },
      "Processing DSPy steps",
    );

    for (const param of params) {
      try {
        await processDSPyStep(project, param);
      } catch (error) {
        if (error instanceof z.ZodError) {
          logger.error(
            {
              error,
              stepId: param.index,
              runId: param.run_id,
              projectId: project.id,
            },
            "failed to validate data for DSPy step",
          );
          captureException(error, {
            extra: { projectId: project.id, param },
          });
          const validationError = fromZodError(error);
          return c.json({ error: validationError.message }, 400);
        } else {
          logger.error(
            {
              error,
              stepId: param.index,
              runId: param.run_id,
              projectId: project.id,
            },
            "internal server error processing DSPy step",
          );
          captureException(error, {
            extra: { projectId: project.id, param },
          });
          return c.json(
            {
              error:
                error instanceof Error ? error.message : "Internal server error",
            },
            500,
          );
        }
      }
    }

    return c.json({ message: "ok" });
  },
);

// =============================================
// POST /api/experiment/init
// =============================================
const dspyInitParamsSchema = z
  .object({
    experiment_id: z.string().optional().nullable(),
    experiment_slug: z.string().optional().nullable(),
    experiment_type: z.enum([
      "DSPY",
      "BATCH_EVALUATION",
      "BATCH_EVALUATION_V2",
    ]),
    experiment_name: z.string().optional(),
    workflowId: z.string().optional(),
  })
  .refine((data) => {
    if (!data.experiment_id && !data.experiment_slug) return false;
    return true;
  });

app.post("/experiment/init", async (c) => {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Bad request" }, 400);
  }

  let params: z.infer<typeof dspyInitParamsSchema>;
  try {
    params = dspyInitParamsSchema.parse(body);
  } catch (error) {
    logger.error(
      { error, body, projectId: project.id },
      "invalid init data received",
    );
    captureException(error, { extra: { projectId: project.id } });
    const validationError = fromZodError(error as ZodError);
    return c.json({ error: validationError.message }, 400);
  }

  let experiment;
  try {
    experiment = await findOrCreateExperiment({
      project,
      experiment_slug: params.experiment_slug,
      experiment_type: params.experiment_type as ExperimentType,
      experiment_name: params.experiment_name,
      workflowId: params.workflowId,
    });
  } catch (error) {
    if (error instanceof LimitExceededError) {
      let message = error.message;
      try {
        const organizationId = await resolveOrganizationId(
          project.teamId,
        );
        if (organizationId) {
          message = await buildResourceLimitMessage({
            organizationId,
            limitType: error.limitType,
            max: error.max,
          });
        }
      } catch {
        logger.warn(
          { projectId: project.id },
          "Failed to build resource limit message",
        );
      }
      return c.json(
        {
          error: error.kind,
          message,
          limitType: error.limitType,
          current: error.current,
          max: error.max,
        },
        403,
      );
    }
    throw error;
  }

  return c.json({
    path: `/${project.slug}/experiments/${experiment.slug}`,
    slug: experiment.slug,
  });
});

// =============================================
// POST /api/mcp/authorize
// =============================================
const REDIS_AUTH_CODE_PREFIX = "mcp:auth_code:";
const AUTH_CODE_TTL_SECONDS = 600;

app.post("/mcp/authorize", async (c) => {
  const session = await getServerAuthSession({ req: c.req.raw as any });
  if (!session?.user?.id) {
    return c.json({ error: "Not authenticated" }, 401);
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid body" }, 400);
  }

  const {
    projectId,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    client_id,
  } = body;

  if (!projectId || !redirect_uri) {
    return c.json(
      { error: "projectId and redirect_uri are required" },
      400,
    );
  }

  try {
    const redirectUrl = new URL(redirect_uri);
    if (
      redirectUrl.protocol === "javascript:" ||
      redirectUrl.protocol === "data:" ||
      redirectUrl.protocol === "vbscript:"
    ) {
      return c.json(
        { error: "redirect_uri uses a disallowed scheme" },
        400,
      );
    }
  } catch {
    return c.json({ error: "Invalid redirect_uri" }, 400);
  }

  if (!code_challenge) {
    return c.json(
      { error: "code_challenge is required (PKCE S256)" },
      400,
    );
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      archivedAt: null,
      team: {
        members: {
          some: { user: { id: session.user.id } },
        },
      },
    },
  });

  if (!project) {
    return c.json(
      { error: "Project not found or you don't have access" },
      403,
    );
  }

  const code = randomUUID();

  if (!redis) {
    return c.json({ error: "Redis is not available" }, 500);
  }

  const authCodeEntry = JSON.stringify({
    projectId: project.id,
    encryptedApiKey: encrypt(project.apiKey),
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method ?? "S256",
    clientId: client_id ?? "",
    expiresAt: Date.now() + AUTH_CODE_TTL_SECONDS * 1000,
  });

  await redis.set(
    `${REDIS_AUTH_CODE_PREFIX}${code}`,
    authCodeEntry,
    "EX",
    AUTH_CODE_TTL_SECONDS,
  );

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  return c.json({ redirect: redirectUrl.toString() });
});

// =============================================
// POST /api/optimization/:workflowId/:versionId  (deprecated)
// =============================================
app.post("/optimization/:workflowId/:versionId", async (c) => {
  const workflowId = c.req.param("workflowId");
  const versionId = c.req.param("versionId");

  const xAuthToken = c.req.header("x-auth-token");
  const authHeader = c.req.header("authorization");
  const authToken =
    xAuthToken ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!authToken) {
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
    return c.json({ message: "Invalid body, expecting json" }, 400);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
    include: { team: true },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Invalid body" }, 400);
  }

  try {
    const result = await runWorkflowFn(
      workflowId,
      project.id,
      body,
      versionId,
    );
    return c.json(result);
  } catch (error) {
    return c.json(
      { message: (error as Error).message },
      500,
    );
  }
});

// =============================================
// GET /api/rerun_checks
// =============================================
app.all("/rerun_checks", async (c) => {
  try {
    const checkId = c.req.query("checkId") as string;
    const projectId = c.req.query("projectId") as string;

    const { default: rerunChecks } = await import("~/tasks/rerunChecks");
    await rerunChecks(checkId, projectId);

    return c.json({ message: "Checks rescheduled" });
  } catch (error: any) {
    return c.json(
      {
        message: "Error starting worker",
        error: error?.message ? error?.message.toString() : `${error}`,
      },
      500,
    );
  }
});

// =============================================
// GET /api/start_workers
// =============================================
const MAX_WORKER_DURATION = 300;

app.all("/start_workers", async (c) => {
  try {
    const maxRuntimeMs = (MAX_WORKER_DURATION - 60) * 1000;
    await start(undefined, maxRuntimeMs);
    return c.json({ message: "Worker done" });
  } catch (error: any) {
    return c.json(
      {
        message: "Error starting worker",
        error: error?.message ? error?.message.toString() : `${error}`,
      },
      500,
    );
  }
});

// =============================================
// POST /api/track_event
// =============================================
const thumbsUpDownSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("thumbs_up_down"),
  metrics: z.object({ vote: z.number().min(-1).max(1) }),
  event_details: z
    .object({ feedback: z.string().nullish() })
    .optional(),
});

const selectedTextSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("selected_text"),
  metrics: z.object({ text_length: z.number().positive() }),
  event_details: z
    .object({ selected_text: z.string().optional() })
    .optional(),
});

const waitedToFinishSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("waited_to_finish"),
  metrics: z.object({ finished: z.number().min(0).max(1) }),
  event_details: z.object({}).optional(),
});

export const predefinedEventsSchemas = z.union([
  thumbsUpDownSchema,
  selectedTextSchema,
  waitedToFinishSchema,
]);

const predefinedEventTypes = predefinedEventsSchemas.options.map(
  (schema) => schema.shape.event_type.value,
);

app.post("/track_event", async (c) => {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  let rawBody: Record<string, any>;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ message: "Bad request" }, 400);
  }

  let body: TrackEventRESTParamsValidator;
  try {
    body = trackEventRESTParamsValidatorSchema.parse(rawBody);
  } catch (error) {
    logger.error(
      { error, body: rawBody, projectId: project.id },
      "invalid event received",
    );
    captureException(error);
    const validationError = fromZodError(error as ZodError);
    return c.json({ error: validationError.message }, 400);
  }

  if (predefinedEventTypes.includes(rawBody.event_type)) {
    try {
      predefinedEventsSchemas.parse(rawBody);
    } catch (error) {
      logger.error(
        { error, body: rawBody, projectId: project.id },
        "invalid event received",
      );
      captureException(error);
      const validationError = fromZodError(error as ZodError);
      return c.json({ error: validationError.message }, 400);
    }
  }

  const eventId =
    body.event_id ??
    generate(KSUID_RESOURCES.TRACKED_EVENT).toString();

  try {
    const timestampMs = body.timestamp ?? Date.now();
    const timestampNano = String(timestampMs * 1_000_000);
    const spanId = createHash("sha256")
      .update(`${body.trace_id}:${eventId}`)
      .digest("hex")
      .slice(0, 16);

    const attributes: {
      key: string;
      value: { stringValue?: string; doubleValue?: number };
    }[] = [
      { key: "event.type", value: { stringValue: body.event_type } },
      { key: "event.id", value: { stringValue: eventId } },
    ];

    for (const [key, value] of Object.entries(body.metrics)) {
      attributes.push({
        key: `event.metrics.${key}`,
        value: { doubleValue: value },
      });
    }

    if (body.event_details) {
      for (const [key, value] of Object.entries(body.event_details)) {
        if (typeof value === "string") {
          attributes.push({
            key: `event.details.${key}`,
            value: { stringValue: value },
          });
        } else if (typeof value === "number") {
          attributes.push({
            key: `event.details.${key}`,
            value: { doubleValue: value },
          });
        } else if (value != null) {
          attributes.push({
            key: `event.details.${key}`,
            value: { stringValue: String(value) },
          });
        }
      }
    }

    await getApp().traces.recordSpan({
      tenantId: project.id,
      span: {
        traceId: body.trace_id,
        spanId,
        traceState: null,
        parentSpanId: null,
        name: TRACK_EVENT_SPAN_NAME,
        kind: ESpanKind.SPAN_KIND_INTERNAL,
        startTimeUnixNano: timestampNano,
        endTimeUnixNano: timestampNano,
        attributes,
        events: [
          {
            name: body.event_type,
            timeUnixNano: timestampNano,
            attributes,
          },
        ],
        links: [],
        status: { code: SpanStatusCode.OK as 1 },
        droppedAttributesCount: null,
        droppedEventsCount: null,
        droppedLinksCount: null,
      },
      resource: { attributes: [] },
      instrumentationScope: { name: TRACK_EVENT_SPAN_NAME },
      piiRedactionLevel: project.piiRedactionLevel,
      occurredAt: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "unable to dispatch tracked event span");
  }

  await trackEventsQueue.add(
    TRACK_EVENTS_QUEUE.JOB,
    {
      project_id: project.id,
      postpone_count: 0,
      event: {
        ...body,
        event_id: eventId,
        timestamp: body.timestamp ?? Date.now(),
      },
    },
    {
      jobId: `${project.id}_track_event_${eventId}`,
      delay: process.env.VITEST_MODE ? 0 : 5000,
    },
  );

  return c.json({ message: "Event tracked" });
});

// =============================================
// POST /api/track_usage
// =============================================
app.post("/track_usage", async (c) => {
  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Bad request" }, 400);
  }

  const { event, instance_id, ...properties } = body;

  const posthog = getPostHogInstance();
  if (posthog) {
    try {
      posthog.capture({
        distinctId: instance_id,
        event,
        properties,
      });
    } catch (error) {
      captureException(error);
    }
  }

  return c.json({ message: "Event captured" });
});

// =============================================
// POST /api/trigger/slack
// =============================================
const filterSchema = z
  .record(
    filterFieldsEnum,
    z.union([
      z.array(z.string()),
      z.record(z.string(), z.array(z.string())),
      z.record(z.string(), z.record(z.string(), z.array(z.string()))),
    ]),
  )
  .default({});

app.post("/trigger/slack", async (c) => {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Bad request" }, 400);
  }

  const schema = z.object({
    slack_webhook: z.string().url("The Slack webhook must be a valid URL"),
    name: z.string(),
    message: z.string().optional(),
    filters: filterSchema,
    alert_type: z.nativeEnum(AlertType),
  });

  try {
    const validatedData = schema.parse(body);

    await prisma.trigger.create({
      data: {
        projectId: project.id,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        name: validatedData.name,
        message: validatedData.message,
        filters: JSON.stringify(validatedData.filters),
        actionParams: { slackWebhook: validatedData.slack_webhook },
        alertType: validatedData.alert_type,
      },
    });

    return c.json({ message: "Slack trigger created successfully" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        { message: "Invalid request data", errors: error.errors },
        400,
      );
    }

    logger.error({ error }, "Error creating trigger");
    return c.json({ message: "Error creating trigger" }, 500);
  }
});

// =============================================
// POST /api/workflows/:workflowId/run
// POST /api/workflows/:workflowId/:versionId/run
// =============================================
app.post("/workflows/:workflowId/run", async (c) => {
  return handleWorkflowRun(c, c.req.param("workflowId"), undefined);
});

app.post("/workflows/:workflowId/:versionId/run", async (c) => {
  return handleWorkflowRun(
    c,
    c.req.param("workflowId"),
    c.req.param("versionId"),
  );
});

async function handleWorkflowRun(
  c: any,
  workflowId: string,
  versionId: string | undefined,
) {
  const xAuthToken = c.req.header("x-auth-token");
  const authHeader = c.req.header("authorization");
  const authToken =
    xAuthToken ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!authToken) {
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
    return c.json({ message: "Invalid body, expecting json" }, 400);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
    include: { team: true },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Invalid body" }, 400);
  }

  try {
    const result = await runWorkflowFn(
      workflowId,
      project.id,
      body,
      versionId,
    );
    return c.json(result);
  } catch (error) {
    return c.json({ message: (error as Error).message }, 500);
  }
}

// =============================================
// POST /api/webhooks/stripe
// =============================================
let webhookHandler: ReturnType<typeof createStripeWebhookHandler> | null =
  null;

app.post("/webhooks/stripe", async (c) => {
  if (!env.IS_SAAS) {
    return c.json({ error: "Not Found" }, 404);
  }

  if (!webhookHandler) {
    webhookHandler = createStripeWebhookHandler();
  }

  // Stripe needs raw body — convert Hono request to a Node-like shim
  // that `micro`'s `buffer()` / the stripe handler can consume.
  // The webhook handler expects NextApiRequest/NextApiResponse, so we
  // bridge it through a promise-based wrapper.
  return new Promise<Response>((resolve) => {
    const nodeReq = c.req.raw as any;
    const fakeRes = createFakeNextRes(resolve);
    webhookHandler!(nodeReq, fakeRes);
  });
});

// =============================================
// Helpers
// =============================================

async function resolveOrganizationId(
  teamId: string,
): Promise<string | null> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { organizationId: true },
  });
  return team?.organizationId ?? null;
}

const generateHash = (data: object) => {
  return crypto.createHash("md5").update(JSON.stringify(data)).digest("hex");
};

const extractLLMCallInfo =
  (llmModelCosts: MaybeStoredLLMModelCost[]) =>
  (call: DSPyLLMCall): DSPyLLMCall => {
    if (
      call.__class__ === "dsp.modules.gpt3.GPT3" ||
      call.response?.object === "chat.completion"
    ) {
      const model = call.response?.model;
      const llmModelCost =
        model &&
        matchModelCostWithFallbacks(call.response.model, llmModelCosts);
      const promptTokens = call.response?.usage?.prompt_tokens;
      const completionTokens = call.response?.usage?.completion_tokens;
      const cost =
        llmModelCost &&
        estimateCost({
          llmModelCost,
          inputTokens: promptTokens ?? 0,
          outputTokens: completionTokens ?? 0,
        });
      return {
        ...call,
        model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cost,
      };
    }
    return call;
  };

const processDSPyStep = async (
  project: Project,
  param: DSPyStepRESTParams,
) => {
  const { run_id, index, experiment_id, experiment_slug } = param;

  const experiment = await findOrCreateExperiment({
    project,
    experiment_id,
    experiment_slug,
    experiment_type: ExperimentType.DSPY,
  });

  const llmModelCosts = await getLLMModelCosts({
    projectId: project.id,
  });

  const now = Date.now();

  let totalSize = 0;
  const examples = param.examples.map((example) => ({
    ...{
      ...example,
      trace: example.trace?.map((t) => {
        if (t.input?.contexts && typeof t.input.contexts !== "string") {
          t.input.contexts = JSON.stringify(t.input.contexts);
        }
        return t;
      }),
    },
    hash: generateHash(example),
  }));

  const llmCalls = param.llm_calls
    .map((call) => ({
      ...call,
      hash: generateHash(call),
    }))
    .map(extractLLMCallInfo(llmModelCosts))
    .map((llmCall) => {
      if (llmCall.response?.output) {
        delete llmCall.response.choices;
      }
      if (llmCall.response) {
        totalSize = JSON.stringify(llmCall).length;
        if (totalSize >= 256_000) {
          llmCall.response.output = "[truncated]";
          llmCall.response.messages = [];
        }
      }
      return llmCall;
    });

  const stepData: DspyStepData = {
    tenantId: project.id,
    experimentId: experiment.id,
    runId: run_id,
    stepIndex: index,
    workflowVersionId: param.workflow_version_id,
    score: param.score,
    label: param.label,
    optimizerName: param.optimizer.name,
    optimizerParameters: param.optimizer.parameters,
    predictors: param.predictors,
    examples,
    llmCalls,
    createdAt: param.timestamps.created_at,
    insertedAt: now,
    updatedAt: now,
  };

  await getApp().dspySteps.steps.upsertStep(stepData);

  logger.info(
    { stepId: param.index, runId: param.run_id, projectId: project.id },
    "Successfully stored DSPy step",
  );
};

// --- Hotel bot helpers ---

const langwatchAPI = async (
  completion: any,
  input: string,
  authToken: string,
  threadId: string,
  userId: string,
  type?: string,
  contexts: string[] = [],
) => {
  try {
    const contentPrefixId = Math.round(Math.random());
    const ragTime = Math.round(Math.random() * 300);

    await fetch(`${env.BASE_HOST}/api/collector`, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        trace_id: `trace_${nanoid()}`,
        spans: [
          ...(type === "rag"
            ? [
                {
                  name: "RestaurantAPI",
                  type: "rag",
                  span_id: `span_${nanoid()}`,
                  input: { type: "text", value: input },
                  contexts: contexts.map((context, index) => ({
                    documentId: `doc_${contentPrefixId}_${index}`,
                    content: context,
                  })),
                  timestamps: {
                    started_at: completion.created * 1000 - ragTime,
                    finished_at: completion.created * 1000,
                  },
                },
              ]
            : []),
          {
            type: "llm",
            span_id: `span_${nanoid()}`,
            vendor: "openai",
            model: completion.model,
            input: {
              type: "chat_messages",
              value: [{ role: "user", content: input }],
            },
            output: {
              type: "chat_messages",
              value: [
                {
                  role: "assistant",
                  content: completion.choices[0].message.content,
                },
              ],
            },
            params: { temperature: 0.7, stream: false },
            metrics: {
              prompt_tokens: completion.usage.prompt_tokens,
              completion_tokens: completion.usage.completion_tokens,
            },
            timestamps: {
              first_token_at: new Date().getTime(),
              started_at: completion.created * 1000,
              finished_at: new Date().getTime(),
            },
          },
        ],
        metadata: {
          thread_id: threadId,
          user_id: userId,
          labels: type === "rag" ? ["Restaurant API"] : [],
        },
      }),
    });
  } catch {
    // Ignore errors in demo bot
  }
};

const userResponse = async (
  userInput: string,
  chatResponse: string,
) => {
  const completion = await hotelBotOpenai.chat.completions.create({
    messages: [
      { role: "system", content: HOTEL_SYSTEM_PROMPT },
      { role: "user", content: userInput },
      { role: "assistant", content: chatResponse },
      {
        role: "user",
        content:
          "Based on the information provided, how would a guest respond to the concierge? Write as if you are the guest.",
      },
    ],
    model: "gpt-3.5-turbo",
  });
  return completion.choices[0]!.message.content;
};

const getInitialMessage = async () => {
  const randomGuestQuery =
    guestQueries[Math.floor(Math.random() * guestQueries.length)];
  const completion = await hotelBotOpenai.chat.completions.create({
    messages: [
      { role: "system", content: HOTEL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Using a support request such as.. ${randomGuestQuery}. Pretend you are the guest! No explanation needed. Don't put quotes around your message. Write as if you are the guest. Max 2 sentences.`,
      },
    ],
    model: "gpt-3.5-turbo",
  });
  return completion.choices[0]!.message.content;
};

const ragMessage = async (authToken: string) => {
  const userInput = "What are the 5 best restaurants in the area?";
  const threadId = `thread_${nanoid()}`;
  const userId = `user_${nanoid()}`;
  const completion = await hotelBotOpenai.chat.completions.create({
    messages: [
      { role: "system", content: RAG_SYSTEM_PROMPT },
      { role: "user", content: userInput },
    ],
    model: "gpt-3.5-turbo",
  });

  const completions = (
    await Promise.all(
      Array.from(
        { length: 2 + Math.floor(Math.random() * 5) },
        () =>
          hotelBotOpenai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "system",
                content:
                  "Invent a restaurant name and a short google maps review of it",
              },
            ],
          }),
      ),
    )
  ).map((c) => c.choices[0]!.message.content ?? "");

  await langwatchAPI(
    completion,
    userInput,
    authToken,
    threadId,
    userId,
    "rag",
    completions,
  );
  return completion.choices[0]!.message.content;
};

const firstChatMessage = async (
  userInput: string,
  threadId: string,
  userId: string,
  authToken: string,
) => {
  const completion = await hotelBotOpenai.chat.completions.create({
    messages: [
      { role: "system", content: HOTEL_SYSTEM_PROMPT },
      { role: "user", content: userInput ?? "" },
    ],
    model: "gpt-3.5-turbo",
  });
  await langwatchAPI(
    completion,
    userInput ?? "",
    authToken,
    threadId,
    userId,
  );
  return completion.choices[0]!.message.content;
};

const secondChatMessage = async (
  userInput: string,
  assistantResponse: string,
  expectedUserResponse: string,
  threadId: string,
  userId: string,
  authToken: string,
) => {
  const completion = await hotelBotOpenai.chat.completions.create({
    messages: [
      { role: "system", content: HOTEL_SYSTEM_PROMPT },
      { role: "user", content: userInput },
      { role: "assistant", content: assistantResponse },
      { role: "user", content: expectedUserResponse },
    ],
    model: "gpt-3.5-turbo",
  });
  await langwatchAPI(
    completion,
    expectedUserResponse ?? "",
    authToken,
    threadId,
    userId,
  );
  return completion.choices[0]!.message.content;
};

/**
 * Creates a fake NextApiResponse-like object that captures the response
 * and resolves the promise with a proper Response. Used for the Stripe
 * webhook handler which expects NextApiRequest/NextApiResponse.
 */
function createFakeNextRes(
  resolve: (value: Response) => void,
): any {
  let statusCode = 200;
  const headers = new Headers();

  return {
    status(code: number) {
      statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | string[]) {
      if (Array.isArray(value)) {
        for (const v of value) {
          headers.append(name, v);
        }
      } else {
        headers.set(name, value);
      }
      return this;
    },
    json(data: any) {
      headers.set("Content-Type", "application/json");
      resolve(
        new Response(JSON.stringify(data), {
          status: statusCode,
          headers,
        }),
      );
    },
    end(body?: string) {
      resolve(
        new Response(body ?? null, { status: statusCode, headers }),
      );
    },
    send(body: string) {
      resolve(
        new Response(body, { status: statusCode, headers }),
      );
    },
  };
}

// =============================================
// GET /image-proxy — SSRF-safe image proxy
// =============================================
app.get("/image-proxy", async (c) => {
  const url = c.req.query("url");
  if (!url) {
    return c.json({ error: "Missing url" }, 400);
  }

  try {
    const { ssrfSafeFetch } = await import("~/utils/ssrfProtection");
    const response = await ssrfSafeFetch(url);

    if (!response.ok) {
      return c.json(
        { error: `Failed to fetch image: ${response.statusText}` },
        response.status as any
      );
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.startsWith("image/")) {
      return c.json({ error: "URL does not point to an image" }, 400);
    }

    const imageBuffer = await response.arrayBuffer();
    return new Response(imageBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch {
    return c.json({ error: "Failed to fetch image" }, 500);
  }
});
