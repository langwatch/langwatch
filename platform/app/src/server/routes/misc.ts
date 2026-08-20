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
 * - src/pages/api/track_event.ts
 * - src/pages/api/track_usage.ts
 * - src/pages/api/trigger/slack.ts
 * - src/pages/api/webhooks/stripe.ts
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import crypto from "crypto";
import { describeRoute, resolver } from "hono-openapi";
import { nanoid } from "nanoid";
import { OpenAI } from "openai";
import type Stripe from "stripe";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { env } from "~/env.mjs";
import type { Project } from "~/generated/prisma/client";
import {
  AlertType,
  ExperimentType,
  TriggerAction,
} from "~/generated/prisma/client";
import { getOAuthClient } from "~/mcp/oauthClientRegistry";
import { isAllowedRedirectScheme } from "~/mcp/redirectSchemes";
import { findOrCreateExperiment } from "~/pages/api/experiment/init";
import {
  type TimeseriesInputType,
  timeseriesSeriesInput,
} from "~/server/analytics/registry";
import { sharedFiltersInputSchema } from "~/server/analytics/types";
import { hasProjectPermission, isDemoProject } from "~/server/api/rbac";
import {
  createServiceApp,
  handlerManagedAuth,
  internalSecret,
  publicEndpoint,
} from "~/server/api/security";
import {
  createUnifiedAuthMiddleware,
  requireApiKeyPermission,
  type UnifiedAuthVariables,
} from "~/server/api-key/auth-middleware";
import { getApp, tryGetApp } from "~/server/app-layer/app";
import type { DspyStepData } from "~/server/app-layer/dspy-steps/types";
import {
  predefinedEventsSchemas,
  predefinedEventTypes,
} from "~/server/app-layer/events/predefinedEvents.schema";
import {
  generateTrackedEventId,
  recordTrackedEventSpan,
} from "~/server/app-layer/events/track-event.service";
import { ProjectService } from "~/server/app-layer/projects/project.service";
import { PrismaProjectRepository } from "~/server/app-layer/projects/repositories/project.prisma.repository";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import {
  type DSPyLLMCall,
  type DSPyStepRESTParams,
  dSPyStepRESTParamsSchema,
} from "~/server/experiments/types";
import { filterFieldsEnum } from "~/server/filters/types";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { buildResourceLimitMessage } from "~/server/license-enforcement/limit-message";
import { getPayloadSizeHistogram } from "~/server/metrics";
import {
  getLLMModelCosts,
  type MaybeStoredLLMModelCost,
} from "~/server/modelProviders/llmModelCost";
import { getPostHogInstance } from "~/server/posthog";
import { rateLimit } from "~/server/rateLimit";
import {
  estimateCost,
  matchModelCostWithFallbacks,
} from "~/server/tracer/collector/cost";
import {
  type TrackEventRESTParamsValidator,
  trackEventRESTParamsValidatorSchema,
} from "~/server/tracer/types";
import { runWorkflow as runWorkflowFn } from "~/server/workflows/runWorkflow";
import { encrypt } from "~/utils/encryption";
import { getClientIpFromHonoContext } from "~/utils/getClientIp";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import { zodErrorMessage } from "~/utils/zodErrorMessage";
import { bodyLimit } from "./_lib/body-limit";
import {
  experimentInitBadRequestSchema,
  experimentInitForbiddenSchema,
  experimentInitResponseSchema,
  handledErrorEnvelopeSchema,
} from "./experiments-v3.schemas";
import {
  acknowledgementSchema,
  analyticsTimeseriesResponseSchema,
  legacySentenceErrorSchema,
  requestBodySchema,
  workflowRunResponseSchema,
} from "./misc.schemas";

/**
 * The body the analytics handler parses, minus `projectId`, which it takes
 * from the authenticated key rather than the request.
 */
const analyticsRequestSchema = sharedFiltersInputSchema
  .omit({ projectId: true })
  .extend(timeseriesSeriesInput.shape);

const logger = createLogger("langwatch:misc");
// Shared auth middlewares for every API-key-aware handler in this file.
// `createUnifiedAuthMiddleware` runs the extractCredentials → TokenResolver
// → setContext → late markUsed pipeline once; `requireApiKeyPermission`
// enforces the per-route ceiling and returns 403 on denial.
const authMiddleware = createUnifiedAuthMiddleware({ prisma });
const requireAnalyticsView = requireApiKeyPermission({
  prisma,
  permission: "analytics:view",
});
const requireWorkflowsManage = requireApiKeyPermission({
  prisma,
  permission: "workflows:manage",
});
// DSPy step logging + experiment bootstrapping are experiment writes, gated on
// the dedicated experiments permission rather than the workflow studio's.
const requireExperimentsManage = requireApiKeyPermission({
  prisma,
  permission: "experiments:manage",
});
const requireTracesCreate = requireApiKeyPermission({
  prisma,
  permission: "traces:create",
});
const requireTriggersManage = requireApiKeyPermission({
  prisma,
  permission: "triggers:manage",
});

const secured = createServiceApp<{ Variables: UnifiedAuthVariables }>({
  basePath: "/api",
});

// Most endpoints here authenticate a project key plus a permission ceiling via
// in-route middleware (authMiddleware + requireApiKeyPermission); the rest are
// documented at their route.
// One policy per grain, mirroring the `requireApiKeyPermission` middleware each
// route applies. A single shared `inRouteAuth` reported nothing at all, so the
// registry could not tell an analytics read from a trigger management call.
const IN_ROUTE_REASON =
  "project auth + permission ceiling enforced by in-route middleware";
const analyticsViewAuth = handlerManagedAuth({
  reason: IN_ROUTE_REASON,
  permissions: ["analytics:view"],
  credential: "apiKey",
});
const experimentsManageAuth = handlerManagedAuth({
  reason: IN_ROUTE_REASON,
  permissions: ["experiments:manage"],
  credential: "apiKey",
});
const workflowsManageAuth = handlerManagedAuth({
  reason: IN_ROUTE_REASON,
  permissions: ["workflows:manage"],
  credential: "apiKey",
});
const tracesCreateAuth = handlerManagedAuth({
  reason: IN_ROUTE_REASON,
  permissions: ["traces:create"],
  credential: "apiKey",
});
const triggersManageAuth = handlerManagedAuth({
  reason: IN_ROUTE_REASON,
  permissions: ["triggers:manage"],
  credential: "apiKey",
});

secured.access(analyticsViewAuth).post(
  "/analytics",
  describeRoute({
    summary: "Query analytics timeseries (legacy path)",
    description:
      "Query analytics timeseries with metrics, aggregations and filters. Identical to `POST /api/analytics/timeseries`, which is the path to use in new integrations; this one stays for callers written against it.",
    tags: ["Analytics"],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: requestBodySchema(analyticsRequestSchema),
        },
      },
    },
    responses: {
      200: {
        description:
          "Timeseries data for the requested range and the one before it",
        content: {
          "application/json": {
            schema: resolver(analyticsTimeseriesResponseSchema),
          },
        },
      },
      400: {
        description: "The body was not valid JSON, or failed validation",
        content: {
          "application/json": {
            schema: resolver(legacySentenceErrorSchema),
          },
        },
      },
      401: {
        description: "Missing or invalid API key",
        content: {
          "application/json": {
            schema: resolver(z.object({ message: z.string() })),
          },
        },
      },
      403: {
        description: "The API key lacks analytics:view",
        content: {
          "application/json": {
            schema: resolver(handledErrorEnvelopeSchema),
          },
        },
      },
    },
  }),
  authMiddleware,
  requireAnalyticsView,
  async (c) => {
    const project = c.get("project");

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
      return c.json({ error: zodErrorMessage(error) }, 400);
    }

    try {
      const analyticsService = getApp().analytics.service;
      const timeseriesResult = await analyticsService.getTimeseries(params);
      return c.json(timeseriesResult);
    } catch (e) {
      if (e instanceof TRPCError && e.code === "BAD_REQUEST") {
        return c.json({ code: e.code, message: e.message }, 400);
      } else {
        throw e;
      }
    }
  },
);

// =============================================
// POST /api/demo/hotel_bot
// =============================================
const hotelBotOpenai = new OpenAI({
  // `||` and not `??`: a present-but-empty OPENAI_API_KEY (a scaffolded .env
  // with the key left blank) must also fall back, or the SDK throws at
  // module load and takes the whole server down with it.
  apiKey: env.OPENAI_API_KEY || "bogus",
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

// NOTE: /demo/hotel_bot is intentionally NOT migrated to the unified
// extractCredentials + TokenResolver + enforceApiKeyCeiling pipeline. It is a
// demo fixture that only forwards the caller's token onward to /api/collector,
// which performs full API-key/legacy auth + ceiling enforcement itself. Adding a
// second layer here would double-validate the same token and require a
// scope that demo tokens may not have.
secured
  .access(
    handlerManagedAuth({
      reason: "demo endpoint validates X-Auth-Token in-handler",
      permissions: [],
      credential: "apiKey",
    }),
  )
  .post("/demo/hotel_bot", async (c) => {
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
secured.access(experimentsManageAuth).post(
  "/dspy/log_steps",
  describeRoute({
    summary: "Report DSPy optimizer steps",
    description:
      "Report the steps of a DSPy optimizer run against an experiment, so the run's progress and scores show up in the app. Send the steps as an array; the optimizer typically posts each batch as it finishes. Bodies up to 20MB are accepted.",
    tags: ["Experiments"],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: requestBodySchema(z.array(dSPyStepRESTParamsSchema)),
        },
      },
    },
    responses: {
      200: {
        description: "Every step in the batch was recorded",
        content: {
          "application/json": { schema: resolver(acknowledgementSchema) },
        },
      },
      400: {
        description:
          "The body was not valid JSON, failed validation, or carried timestamps in seconds rather than milliseconds",
        content: {
          "application/json": {
            schema: resolver(legacySentenceErrorSchema),
          },
        },
      },
      401: {
        description: "Missing or invalid API key",
        content: {
          "application/json": {
            schema: resolver(z.object({ message: z.string() })),
          },
        },
      },
      403: {
        description: "The API key lacks experiments:manage",
        content: {
          "application/json": {
            schema: resolver(handledErrorEnvelopeSchema),
          },
        },
      },
      500: {
        description:
          "A step could not be stored. The cause is on our side and is logged with the run and step ids; retrying the batch is safe.",
        content: {
          "application/json": {
            schema: resolver(legacySentenceErrorSchema),
          },
        },
      },
    },
  }),
  bodyLimit({ maxSize: 20 * 1024 * 1024 }),
  authMiddleware,
  requireExperimentsManage,
  async (c) => {
    const project = c.get("project");

    let body: unknown;
    let payloadSize: number;
    try {
      // Take the size from the wire bytes rather than re-serialising the
      // parsed body: bodies here run to 20MB, and the old
      // `JSON.stringify(body).length` both cost a full second pass and
      // reported UTF-16 code units instead of transferred bytes.
      const raw = await c.req.text();
      payloadSize = Buffer.byteLength(raw, "utf8");
      body = JSON.parse(raw);
    } catch {
      return c.json({ message: "Bad request" }, 400);
    }

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
      captureException(toError(error), { extra: { projectId: project.id } });
      return c.json({ error: zodErrorMessage(error) }, 400);
    }

    for (const param of params) {
      if (
        param.timestamps.created_at &&
        param.timestamps.created_at.toString().length === 10
      ) {
        logger.error(
          {
            stepId: param.index,
            runId: param.run_id,
            projectId: project.id,
          },
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
          captureException(toError(error), {
            extra: {
              projectId: project.id,
              stepId: param.index,
              runId: param.run_id,
            },
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
          captureException(toError(error), {
            extra: {
              projectId: project.id,
              stepId: param.index,
              runId: param.run_id,
            },
          });
          return c.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Internal server error",
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

secured.access(experimentsManageAuth).post(
  "/experiment/init",
  describeRoute({
    summary: "Create an experiment",
    description:
      "Create an experiment, or return the existing one when the slug is already taken. This is the first call in an experiment run: take the slug back, report results against it, and every run under that slug groups together in the app. The SDKs call this endpoint for you.",
    tags: ["Experiments"],
    // Declared by hand rather than through zValidator: this handler parses and
    // validates the body itself and answers its own sentence on a bad one, so
    // there is no validator schema for the generator to read. `experiment_slug`
    // and `experiment_id` are individually optional and jointly required, which
    // `oneOf` states and a required-list cannot.
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              experiment_slug: {
                type: "string",
                description:
                  "Stable slug you choose. Reusing it returns the same experiment instead of creating another, which is what makes repeated runs land together.",
              },
              experiment_id: {
                type: "string",
                description:
                  "Existing experiment id, as an alternative to the slug",
              },
              experiment_type: {
                type: "string",
                enum: ["DSPY", "BATCH_EVALUATION", "BATCH_EVALUATION_V2"],
                description:
                  "BATCH_EVALUATION_V2 for SDK batch evaluations, DSPY for optimizer runs",
              },
              experiment_name: {
                type: "string",
                description:
                  "Display name, used only when the experiment is created",
              },
              workflowId: {
                type: "string",
                description:
                  "Optimization Studio workflow this experiment belongs to",
              },
            },
            required: ["experiment_type"],
            // `anyOf`, not `oneOf`: the handler's refine only asks that at
            // least one identifier is present, and sending both is accepted.
            // `oneOf` would document exactly-one and reject a valid body.
            anyOf: [
              { required: ["experiment_slug"] },
              { required: ["experiment_id"] },
            ],
          },
        },
      },
    },
    responses: {
      200: {
        description: "The experiment, created or already existing",
        content: {
          "application/json": {
            schema: resolver(experimentInitResponseSchema),
          },
        },
      },
      400: {
        description:
          "The body was not valid JSON, or neither experiment_slug nor experiment_id was supplied",
        content: {
          "application/json": {
            schema: resolver(experimentInitBadRequestSchema),
          },
        },
      },
      401: {
        description: "Missing or invalid API key",
        content: {
          "application/json": {
            schema: resolver(z.object({ message: z.string() })),
          },
        },
      },
      403: {
        description:
          "The API key lacks experiments:manage, or the plan's experiment limit is already reached",
        content: {
          "application/json": {
            schema: resolver(experimentInitForbiddenSchema),
          },
        },
      },
    },
  }),
  authMiddleware,
  requireExperimentsManage,
  async (c) => {
    const project = c.get("project");

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
      captureException(toError(error), { extra: { projectId: project.id } });
      return c.json({ error: zodErrorMessage(error) }, 400);
    }

    let experiment;
    try {
      experiment = await findOrCreateExperiment({
        project,
        // The body accepts either identifier and this handler used to forward
        // only the slug, so an id-only request passed validation and then hit
        // "Either experiment_id or experiment_slug is required" as a 500.
        // Every other caller of this function forwards both.
        experiment_id: params.experiment_id,
        experiment_slug: params.experiment_slug,
        experiment_type: params.experiment_type as ExperimentType,
        experiment_name: params.experiment_name,
        workflowId: params.workflowId,
      });
    } catch (error) {
      if (error instanceof LimitExceededError) {
        let message = error.message;
        try {
          const organizationId = await resolveOrganizationId(project.teamId);
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
            error: error.code,
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
  },
);

// =============================================
// POST /api/mcp/authorize
// =============================================
const REDIS_AUTH_CODE_PREFIX = "mcp:auth_code:";
const AUTH_CODE_TTL_SECONDS = 600;

secured
  .access(
    handlerManagedAuth({
      reason: "user session validated in-handler via getServerAuthSession",
      // OAuth authorize step; no RBAC permission gates it.
      permissions: [],
      credential: "session",
    }),
  )
  .post("/mcp/authorize", async (c) => {
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

    if (!projectId || !redirect_uri || !client_id) {
      return c.json(
        { error: "projectId, redirect_uri and client_id are required" },
        400,
      );
    }

    try {
      new URL(redirect_uri);
    } catch {
      return c.json({ error: "Invalid redirect_uri" }, 400);
    }
    if (!isAllowedRedirectScheme(redirect_uri)) {
      return c.json({ error: "redirect_uri uses a disallowed scheme" }, 400);
    }

    // RFC 6749 §10.6: an authorization server must only ever issue a code to
    // a redirect_uri that was registered for this client_id — otherwise
    // whoever crafts the authorization request (which can be an attacker,
    // not the approving user) can point it at a URI they control and the
    // approved code is exfiltrated there. PKCE does not defend against this:
    // it proves the token-exchanger holds the verifier for the challenge in
    // the code, and an attacker who authored the request holds both. Exact
    // string match against the client's /oauth/register'd redirect_uris —
    // no scheme/host-only comparison, which a subdomain or path trick could
    // slip past.
    const registeredClient = await getOAuthClient(client_id);
    if (!registeredClient) {
      return c.json({ error: "Unknown or unregistered client_id" }, 400);
    }
    if (!registeredClient.redirectUris.includes(redirect_uri)) {
      return c.json(
        {
          error:
            "redirect_uri does not match any redirect URI registered for this client_id",
        },
        400,
      );
    }

    // Past this point the client_id is registered and the redirect_uri is one
    // of the URIs it registered, so RFC 6749 §4.1.2.1 says a failure belongs
    // back at the client rather than on this page: the client is waiting on
    // its redirect and an error rendered here leaves it hanging forever. The
    // checks above deliberately stay local — an unverified redirect_uri is
    // exactly what an attacker would supply, so nothing is ever sent to it.
    //
    // The refusals below answer with `c.json` rather than throwing a
    // HandledError on purpose. OAuth clients parse `error` and
    // `error_description` at the top level of the body (RFC 6749 §5.2), and
    // the HandledError envelope nests its own shape, which those clients read
    // as a malformed response. This endpoint speaks the OAuth wire format, so
    // the shape below is the contract; do not "fix" it into the envelope.
    const errorRedirect = ({
      error,
      description,
    }: {
      error: string;
      description: string;
    }) => {
      const url = new URL(redirect_uri);
      url.searchParams.set("error", error);
      url.searchParams.set("error_description", description);
      if (state) {
        url.searchParams.set("state", state);
      }
      return url.toString();
    };

    if (!code_challenge) {
      const description = "code_challenge is required (PKCE S256)";
      return c.json(
        {
          error: "invalid_request",
          error_description: description,
          redirect: errorRedirect({ error: "invalid_request", description }),
        },
        400,
      );
    }

    // S256 is the only method the discovery document advertises, and the token
    // endpoint verifies every code as S256 regardless of what was requested.
    // Accepting another method here would mint a code that can never be
    // redeemed, so the client learns now rather than at the exchange.
    if (code_challenge_method && code_challenge_method !== "S256") {
      const description = "code_challenge_method must be S256";
      return c.json(
        {
          error: "invalid_request",
          error_description: description,
          redirect: errorRedirect({ error: "invalid_request", description }),
        },
        400,
      );
    }

    // The demo project is a globally-readable showcase: isDemoProject grants
    // `project:view` to ANY caller, so it must never reach the RoleBinding check
    // below — otherwise any authenticated user could mint an MCP auth code
    // embedding the demo project's API key. (The old `team.members.some` check
    // happened to block this; the RoleBinding-aware check does not.)
    const noAccessDescription = "Project not found or you don't have access";
    const noAccessResponse = () =>
      c.json(
        {
          error: "access_denied",
          error_description: noAccessDescription,
          redirect: errorRedirect({
            error: "access_denied",
            description: noAccessDescription,
          }),
        },
        403,
      );

    if (isDemoProject(projectId, "project:view")) {
      return noAccessResponse();
    }

    // Authorize against RoleBindings (the authoritative source since migration
    // 20260407120000_migrate_team_users_to_role_bindings), not the legacy
    // TeamUser relation. A user added to the team after that migration has no
    // TeamUser row, so the old `team.members.some` check rejected them with a
    // false 403. `project:view` is the baseline grant every team role (incl.
    // VIEWER) has, and hasProjectPermission also honors org-level access.
    // ProjectService is constructed directly (not via getApp()) so this handler
    // stays unit-testable without booting the app container — the same pattern
    // used in presets.ts and the project-service middleware.
    const projectService = new ProjectService(
      new PrismaProjectRepository(prisma),
    );
    const project = await projectService.getById(projectId);

    if (
      !project ||
      project.archivedAt !== null ||
      !(await hasProjectPermission(
        { prisma, session },
        projectId,
        "project:view",
      ))
    ) {
      // Single 403 whether the project is missing, archived, or simply
      // inaccessible — never disclose existence of a project the caller can't reach.
      return noAccessResponse();
    }

    const code = randomUUID();

    const redis = tryGetApp()?.redis ?? null;
    if (!redis) {
      const description = "Authorization is temporarily unavailable";
      return c.json(
        {
          error: "server_error",
          error_description: description,
          redirect: errorRedirect({ error: "server_error", description }),
        },
        500,
      );
    }

    const authCodeEntry = JSON.stringify({
      projectId: project.id,
      encryptedApiKey: encrypt(project.apiKey),
      // Captured here so MCP tools that need a caller identity (e.g.,
      // governance install/uninstall/rotate) can attribute audit rows to
      // the actual OAuth-flowing user instead of falling back to a project-
      // wide identity. Read in handler.ts at the token-exchange step.
      userId: session.user.id,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method ?? "S256",
      // Bound here so /oauth/token can require the exchange to present the
      // exact same client_id + redirect_uri this authorization was validated
      // and approved against (RFC 6749 §4.1.3 / §3.2.1) — a code minted for
      // one client's registered URI must never be redeemable against another.
      clientId: client_id,
      redirectUri: redirect_uri,
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

/**
 * What every synchronous workflow-run route documents.
 *
 * The three of them delegate to one handler, so they answer the same shapes;
 * only the path parameters and the wording differ, and those are spread in at
 * each registration.
 */
const workflowRunResponses = {
  200: {
    description: "The workflow finished; `result` holds its output fields",
    content: {
      "application/json": { schema: resolver(workflowRunResponseSchema) },
    },
  },
  400: {
    description:
      "The request was not sent as application/json, or the body was not valid JSON",
    content: {
      "application/json": {
        schema: resolver(z.object({ message: z.string() })),
      },
    },
  },
  401: {
    description: "Missing or invalid API key",
    content: {
      "application/json": {
        schema: resolver(z.object({ message: z.string() })),
      },
    },
  },
  403: {
    description: "The API key lacks workflows:manage",
    content: {
      "application/json": { schema: resolver(handledErrorEnvelopeSchema) },
    },
  },
  404: {
    description: "No such workflow, or it has never been published",
    content: {
      "application/json": { schema: resolver(handledErrorEnvelopeSchema) },
    },
  },
} as const;

/**
 * A workflow run takes the workflow's own entry fields as its body, so there is
 * no fixed set of properties to name: open the object and say where the names
 * come from.
 */
const workflowRunRequestBody = {
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object" as const,
        additionalProperties: true,
        description:
          "The workflow's input fields, named as the workflow's entry node names them",
      },
    },
  },
};

// =============================================
// POST /api/optimization/:workflowId/:versionId  (deprecated)
// =============================================
secured.access(workflowsManageAuth).post(
  "/optimization/:workflowId/:versionId",
  describeRoute({
    summary: "Run a workflow version (legacy path)",
    description:
      "Run one pinned version of an Optimization Studio workflow synchronously. Identical to `POST /api/workflows/{workflowId}/{versionId}/run`, which is the path to use in new integrations; this one stays for callers written against it.",
    tags: ["Workflows"],
    requestBody: workflowRunRequestBody,
    responses: workflowRunResponses,
  }),
  authMiddleware,
  requireWorkflowsManage,
  async (c) => {
    // Delegates to the same handler as POST /workflows/:workflowId/:versionId/run
    // (below) — this route used to duplicate that logic with its own
    // catch-and-flatten-to-500, which had drifted to disagree with the
    // canonical route on the status code for identical failures.
    return handleWorkflowRun(
      c,
      c.req.param("workflowId"),
      c.req.param("versionId"),
    );
  },
);

// =============================================
// POST /api/track_event
// =============================================
// Both this legacy URL and the canonical POST /api/events/track route
// through track-event.service so behaviour stays identical between them.
secured.access(tracesCreateAuth).post(
  "/track_event",
  describeRoute({
    summary: "Track an event (legacy path)",
    description:
      "Record a customer event against a trace or thread. Identical to `POST /api/events/track`, which is the path to use in new integrations; this one stays for callers written against it. Supply `event_id` yourself to make the call idempotent.",
    tags: ["Events"],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: requestBodySchema(trackEventRESTParamsValidatorSchema),
        },
      },
    },
    responses: {
      200: {
        description: "The event was accepted",
        content: {
          "application/json": { schema: resolver(acknowledgementSchema) },
        },
      },
      400: {
        description: "The body was not valid JSON, or failed validation",
        content: {
          "application/json": { schema: resolver(legacySentenceErrorSchema) },
        },
      },
      401: {
        description: "Missing or invalid API key",
        content: {
          "application/json": {
            schema: resolver(z.object({ message: z.string() })),
          },
        },
      },
      403: {
        description: "The API key lacks traces:create",
        content: {
          "application/json": {
            schema: resolver(handledErrorEnvelopeSchema),
          },
        },
      },
    },
  }),
  authMiddleware,
  requireTracesCreate,
  async (c) => {
    const project = c.get("project");

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
      captureException(toError(error));
      return c.json({ error: zodErrorMessage(error) }, 400);
    }

    if (predefinedEventTypes.includes(rawBody.event_type)) {
      try {
        predefinedEventsSchemas.parse(rawBody);
      } catch (error) {
        logger.error(
          { error, body: rawBody, projectId: project.id },
          "invalid event received",
        );
        captureException(toError(error));
        return c.json({ error: zodErrorMessage(error) }, 400);
      }
    }

    const eventId = body.event_id ?? generateTrackedEventId();

    try {
      await recordTrackedEventSpan({ project, body, eventId });
    } catch (error) {
      logger.error({ error }, "unable to dispatch tracked event span");
    }

    return c.json({ message: "Event tracked" });
  },
);

// =============================================
// POST /api/track_usage
// =============================================
// Self-hosted instances report anonymous daily usage counts here with no
// credential to present (see usageStatsWorker.ts), so the route stays public.
// What it accepts is bounded instead:
//   - `.strict()` schema matching exactly the one report `collectUsageStats`
//     produces, so a spoofed event can't also smuggle arbitrary properties
//     into PostHog even once it gets the event name right
//   - a capped payload size
//   - a global rate limit — the actual bound. `ip` and `instance_id` are both
//     values the caller supplies, so an abuser rotates either one and lands
//     in a fresh bucket every request (mirrors the reasoning in
//     rum-ingest.service.ts). Checked first, on a fixed key, so a flood the
//     global bucket is already refusing doesn't also mint a fresh per-caller
//     Redis key on every request.
//   - per-IP and per-instance limits on top, for fairness once under the cap
const TRACK_USAGE_EVENT = "daily_usage_stats";
// Every stat field is `.optional()`, not required: this receiver is a stable
// contract that self-hosted instances at ANY historical version hit (see
// usageStatsWorker.ts's docstring), so an older sender predating a field
// collectUsageStats.ts later added (or a newer one with a field this receiver
// doesn't know about yet) must still be accepted rather than 400'd — a
// self-hosted operator gets zero feedback on a rejected send (the worker logs
// success unconditionally once `fetch` resolves, without checking `.ok`), so
// a strict shape mismatch here would silently and permanently drop that
// instance's telemetry. `.strict()` still closes the actual security gap by
// rejecting keys outside this known set — the two constraints don't conflict.
const trackUsageBodySchema = z
  .object({
    event: z.literal(TRACK_USAGE_EVENT),
    instance_id: z.string().min(1).max(200),
    install_method: z.string().max(100).optional(),
    hostname: z.string().max(255).optional(),
    environment: z.string().max(50).optional(),
    totalTraces: z.number().optional(),
    totalScenarioEvents: z.number().optional(),
    annotations: z.number().optional(),
    annotationQueues: z.number().optional(),
    annotationQueueItems: z.number().optional(),
    annotationScores: z.number().optional(),
    batchEvaluations: z.number().optional(),
    customGraphs: z.number().optional(),
    datasets: z.number().optional(),
    datasetRecords: z.number().optional(),
    experiments: z.number().optional(),
    triggers: z.number().optional(),
    workflows: z.number().optional(),
    timestamp: z.string().optional(),
  })
  .strict();

// A self-hosted instance sends this once per organization per day
// (usageStatsWorker.ts), so these ceilings stay generous for legitimate
// traffic while bounding abuse.
const TRACK_USAGE_GLOBAL_PER_MINUTE = 500;
const TRACK_USAGE_PER_IP_PER_MINUTE = 10;
const TRACK_USAGE_PER_INSTANCE_PER_HOUR = 5;

interface TrackUsageRateLimitVerdict {
  allowed: boolean;
  retryAfterSeconds: number;
}

function toVerdict(result: {
  allowed: boolean;
  resetAt: number;
}): TrackUsageRateLimitVerdict {
  return {
    allowed: result.allowed,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((result.resetAt - Date.now()) / 1000),
    ),
  };
}

/**
 * Checked before the body is even parsed, on keys no request-body field can
 * influence, so a flood of malformed JSON is capped exactly like valid
 * traffic — an attacker can't dodge the limiter just by sending garbage.
 */
async function enforceGlobalAndIpRateLimit(
  ip: string,
): Promise<TrackUsageRateLimitVerdict> {
  const global = await rateLimit({
    key: "track_usage:global",
    windowSeconds: 60,
    max: TRACK_USAGE_GLOBAL_PER_MINUTE,
  });
  if (!global.allowed) return toVerdict(global);

  const perIp = await rateLimit({
    key: `track_usage:ip:${ip}`,
    windowSeconds: 60,
    max: TRACK_USAGE_PER_IP_PER_MINUTE,
  });
  return toVerdict(perIp);
}

async function enforceInstanceRateLimit(
  instanceId: string,
): Promise<TrackUsageRateLimitVerdict> {
  const perInstance = await rateLimit({
    key: `track_usage:instance:${instanceId}`,
    windowSeconds: 3600,
    max: TRACK_USAGE_PER_INSTANCE_PER_HOUR,
  });
  return toVerdict(perInstance);
}

secured
  .access(publicEndpoint("anonymous product telemetry, no credential"))
  .post("/track_usage", bodyLimit({ maxSize: 10 * 1024 }), async (c) => {
    const ip = getClientIpFromHonoContext(c) ?? "unknown";

    const ipLimit = await enforceGlobalAndIpRateLimit(ip);
    if (!ipLimit.allowed) {
      c.header("Retry-After", String(ipLimit.retryAfterSeconds));
      return c.json({ message: "Too many requests" }, 429);
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ message: "Bad request" }, 400);
    }

    const parsed = trackUsageBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ message: "Bad request" }, 400);
    }
    const { event, instance_id, ...properties } = parsed.data;

    const instanceLimit = await enforceInstanceRateLimit(instance_id);
    if (!instanceLimit.allowed) {
      c.header("Retry-After", String(instanceLimit.retryAfterSeconds));
      return c.json({ message: "Too many requests" }, 429);
    }

    const posthog = getPostHogInstance();
    if (posthog) {
      try {
        posthog.capture({
          distinctId: instance_id,
          event,
          properties,
        });
      } catch (error) {
        captureException(toError(error));
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

const slackTriggerBodySchema = z.object({
  slack_webhook: z
    .string()
    .url()
    .describe("Incoming webhook URL the alert is posted to"),
  name: z.string().describe("How the trigger is listed in the app"),
  message: z
    .string()
    .optional()
    .describe("Extra line included with each alert"),
  filters: filterSchema.describe(
    "Which traces the trigger fires on. An empty object fires on all of them.",
  ),
  alert_type: z.nativeEnum(AlertType),
});

secured.access(triggersManageAuth).post(
  "/trigger/slack",
  describeRoute({
    summary: "Create a Slack alert trigger",
    description:
      "Create a trigger that posts to a Slack incoming webhook when traces match its filters. The `/api/triggers` family supersedes this narrower form, which stays for callers written against it.",
    tags: ["Triggers"],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: requestBodySchema(slackTriggerBodySchema),
        },
      },
    },
    responses: {
      200: {
        description: "The trigger was created",
        content: {
          "application/json": { schema: resolver(acknowledgementSchema) },
        },
      },
      400: {
        description: "The body was not valid JSON, or failed validation",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                message: z.string(),
                errors: z
                  .array(z.record(z.string(), z.unknown()))
                  .optional()
                  .describe("The individual validation failures, when present"),
              }),
            ),
          },
        },
      },
      401: {
        description: "Missing or invalid API key",
        content: {
          "application/json": {
            schema: resolver(z.object({ message: z.string() })),
          },
        },
      },
      403: {
        description: "The API key lacks triggers:manage",
        content: {
          "application/json": {
            schema: resolver(handledErrorEnvelopeSchema),
          },
        },
      },
    },
  }),
  authMiddleware,
  requireTriggersManage,
  async (c) => {
    const project = c.get("project");

    let body: Record<string, any>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ message: "Bad request" }, 400);
    }

    try {
      const validatedData = slackTriggerBodySchema.parse(body);

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
  },
);

// =============================================
// POST /api/workflows/:workflowId/run
// POST /api/workflows/:workflowId/:versionId/run
// =============================================
secured.access(workflowsManageAuth).post(
  "/workflows/:workflowId/run",
  describeRoute({
    summary: "Run a workflow",
    description:
      "Run an Optimization Studio workflow synchronously and return its output. Runs the workflow's published version; address a specific version with the `{versionId}` form of this path.",
    tags: ["Workflows"],
    requestBody: workflowRunRequestBody,
    responses: workflowRunResponses,
  }),
  authMiddleware,
  requireWorkflowsManage,
  async (c) => {
    return handleWorkflowRun(c, c.req.param("workflowId"), undefined);
  },
);

secured.access(workflowsManageAuth).post(
  "/workflows/:workflowId/:versionId/run",
  describeRoute({
    summary: "Run a specific workflow version",
    description:
      "Run one pinned version of an Optimization Studio workflow synchronously and return its output. Use this when a caller must keep hitting the same version as the workflow is edited.",
    tags: ["Workflows"],
    requestBody: workflowRunRequestBody,
    responses: workflowRunResponses,
  }),
  authMiddleware,
  requireWorkflowsManage,
  async (c) => {
    return handleWorkflowRun(
      c,
      c.req.param("workflowId"),
      c.req.param("versionId"),
    );
  },
);

async function handleWorkflowRun(
  c: any,
  workflowId: string,
  versionId: string | undefined,
) {
  const contentType = c.req.header("content-type");
  if (!contentType?.includes("application/json")) {
    return c.json({ message: "Invalid body, expecting json" }, 400);
  }

  const project = c.get("project");

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Invalid body" }, 400);
  }

  // Let errors propagate to the app's onError(handleError) middleware — it
  // already knows how to map HandledError subclasses (e.g. runWorkflow's
  // NotFoundError/ValidationError) to the right status code. Catching here
  // and hard-coding 500 was masking those as raw 500s regardless of type.
  const result = await runWorkflowFn(workflowId, project.id, body, versionId);
  return c.json(result);
}

// =============================================
// POST /api/webhooks/stripe
// =============================================
secured
  .access(internalSecret("Stripe webhook signature verified in-handler"))
  .post("/webhooks/stripe", async (c) => {
    const { webhookService, stripeClient } = getApp();
    if (!env.IS_SAAS || !webhookService || !stripeClient) {
      return c.json({ error: "Not Found" }, 404);
    }

    const sig = c.req.header("stripe-signature");
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !secret) {
      logger.error(
        { sig: !!sig, secret: !!secret },
        "[stripeWebhook] Missing signature or secret",
      );
      return c.text("Webhook Error: Missing signature or secret", 400);
    }

    let event: Stripe.Event;
    try {
      const rawBody = Buffer.from(await c.req.arrayBuffer());
      event = stripeClient.webhooks.constructEvent(rawBody, sig, secret);
    } catch (error) {
      logger.error(
        { error: (error as Error).message },
        "[stripeWebhook] Failed to construct event",
      );
      return c.text("Webhook Error: Invalid payload or signature", 400);
    }

    const result = await webhookService.handleEvent(event);
    if (result.status === "error") {
      return c.text(result.message, result.httpStatus);
    }
    return c.json({ received: true });
  });

// =============================================
// Helpers
// =============================================

async function resolveOrganizationId(teamId: string): Promise<string | null> {
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

const processDSPyStep = async (project: Project, param: DSPyStepRESTParams) => {
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

const userResponse = async (userInput: string, chatResponse: string) => {
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
      Array.from({ length: 2 + Math.floor(Math.random() * 5) }, () =>
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
  await langwatchAPI(completion, userInput ?? "", authToken, threadId, userId);
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

// =============================================
// GET /image-proxy — SSRF-safe image proxy
// =============================================
secured
  .access(publicEndpoint("SSRF-guarded image proxy, no credential"))
  .get("/image-proxy", async (c) => {
    const url = c.req.query("url");
    if (!url) {
      return c.json({ error: "Missing url" }, 400);
    }

    try {
      const response = await ssrfSafeFetch(url);

      if (!response.ok) {
        return c.json(
          { error: `Failed to fetch image: ${response.statusText}` },
          response.status as any,
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

export const app = secured.hono;
