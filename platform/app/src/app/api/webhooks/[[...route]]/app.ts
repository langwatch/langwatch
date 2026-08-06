import { randomUUID } from "node:crypto";
import {
  assertWebhookEndpointsEntitled,
  WebhookEndpointsNotEntitledError,
} from "@ee/webhooks/entitlement";
import { WEBHOOK_EVENT_TYPES } from "@ee/webhooks/eventRegistry";
import { WebhookEndpointService } from "@ee/webhooks/webhookEndpoint.service";
import {
  WebhookEventNotFoundError,
  WebhookEventsService,
} from "@ee/webhooks/webhookEvents.service";
import { WebhookHealthService } from "@ee/webhooks/webhookHealth.service";
import { createLogger } from "@langwatch/observability";
import type { Organization } from "@prisma/client";
import type { Context, Next } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import {
  IDEMPOTENCY_KEY_HEADER,
  readIdempotencyKey,
  withIdempotency,
} from "~/server/api/idempotency";
import { createOrgApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { PrismaProcessStore } from "~/server/event-sourcing/process-manager/stores/prismaProcessStore";
import { toStoredEnum, toWireEnum } from "~/server/gateway/wireEnums";
import {
  sendWebhook,
  WEBHOOK_DELIVERY_ID_HEADER,
} from "~/server/webhooks/sendWebhook";
import { allowsInsecureLocalUrls } from "~/server/webhooks/urlPolicy";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import {
  canonicalBaseResponses,
  canonicalConflictResponses,
} from "../../shared/base-responses";
import { BadRequestError, ForbiddenError } from "../../shared/errors";
import {
  idempotencyKeyParameter,
  idempotentJson,
  idempotentReplayHeaders,
} from "../../shared/idempotent-response";
import { apiErrorSchema } from "../../shared/schemas";
import { handleWebhookApiError } from "./error-handler";

patchZodOpenapi();

const endpoints = new WebhookEndpointService({ prisma });
const health = new WebhookHealthService({
  endpoints,
  processStore: new PrismaProcessStore(prisma),
});

/**
 * Resolved per call rather than at module scope, so every route shares the
 * one repository `getApp()` hands out instead of minting its own, and the
 * deployment's ClickHouse configuration is read at request time, not once
 * at import time. Undefined on a deployment without ClickHouse — the
 * emitted-events log has no fallback store — which this reports the same
 * way the old inline resolver did: a plain "not configured" refusal.
 */
function requireEventsService(): WebhookEventsService {
  const repository = getApp().gateway.webhookEvents;
  if (!repository) throw new Error("ClickHouse is not configured");
  return new WebhookEventsService({ prisma, repository });
}

/**
 * Enterprise gate for the whole surface, delegating to the one shared
 * entitlement check. Runs after the org auth chain so the organization is
 * on the context.
 */
async function requireWebhookPlan(c: Context, next: Next): Promise<void> {
  const organization = c.get("organization") as Organization;
  try {
    await assertWebhookEndpointsEntitled(organization.id);
  } catch (error) {
    if (error instanceof WebhookEndpointsNotEntitledError) {
      throw new ForbiddenError(error.message);
    }
    throw error;
  }
  await next();
}

// ── Wire enums ──────────────────────────────────────────────────────────
// Every enum this surface publishes and accepts is lower_snake_case, input
// AND output, with no dual-casing tolerance: the stored SCREAMING_SNAKE is
// Prisma's convention, not a contract, and `toWireEnum` / `toStoredEnum`
// translate at this seam in both directions.

const endpointStatusSchema = z.enum(["active", "disabled"]);

const deliveryControlsSchema = {
  max_batch_size: z.number().int().optional(),
  max_batch_delay_ms: z.number().int().optional(),
  max_in_flight: z.number().int().optional(),
};

const createEndpointSchema = z.object({
  url: z.string().min(1).max(2000),
  enabled_events: z.array(z.string().min(1).max(200)).min(1).max(100),
  ...deliveryControlsSchema,
});

const updateEndpointSchema = z.object({
  url: z.string().min(1).max(2000).optional(),
  enabled_events: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(100)
    .optional(),
  status: endpointStatusSchema.optional(),
  ...deliveryControlsSchema,
});

const deliveriesQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

const eventsQuerySchema = z
  .object({
    type: z.string().min(1).max(200).optional(),
    // The events log is a RANGED read by contract, the same contract the
    // spend-events pull carries and over the same table: without bounds the
    // walk sorts the whole 13-month table under FINAL on every page.
    from: z.coerce.number().int().positive().safe(),
    to: z.coerce.number().int().positive().safe(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().positive().max(200).optional().default(50),
  })
  .refine((q) => q.from <= q.to, {
    message: "from must be less than or equal to to",
  });

function endpointResponse(endpoint: {
  id: string;
  url: string;
  enabledEvents: string[];
  status: "ACTIVE" | "DISABLED";
  disabledReason: string | null;
  disabledAt: Date | null;
  failingSince: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  maxBatchSize: number;
  maxBatchDelayMs: number;
  maxInFlight: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    enabled_events: endpoint.enabledEvents,
    status: toWireEnum(endpoint.status),
    disabled_reason: endpoint.disabledReason,
    disabled_at: endpoint.disabledAt?.toISOString() ?? null,
    failing_since: endpoint.failingSince?.toISOString() ?? null,
    last_success_at: endpoint.lastSuccessAt?.toISOString() ?? null,
    last_failure_at: endpoint.lastFailureAt?.toISOString() ?? null,
    max_batch_size: endpoint.maxBatchSize,
    max_batch_delay_ms: endpoint.maxBatchDelayMs,
    max_in_flight: endpoint.maxInFlight,
    created_at: endpoint.createdAt.toISOString(),
    updated_at: endpoint.updatedAt.toISOString(),
  };
}

// ── Response DTO schemas (used by describeRoute for OpenAPI gen) ────────
// {@link endpointResponse} is the one builder behind create, list, get,
// patch and roll-secret, so one schema describes all five.

const endpointDtoSchema = z.object({
  id: z.string(),
  url: z.string(),
  enabled_events: z.array(z.string()),
  status: endpointStatusSchema,
  /** `manual` when an operator paused it, `auto_failures_72h` when the
   *  failure ladder did. Null while the endpoint is active. */
  disabled_reason: z.string().nullable(),
  disabled_at: z.string().nullable(),
  failing_since: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
  max_batch_size: z.number().int(),
  max_batch_delay_ms: z.number().int(),
  max_in_flight: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * The endpoint plus its plaintext signing secret. Create and roll-secret are
 * the only two responses that carry it; every read serves
 * {@link endpointDtoSchema}, which has no `secret` field to be absent from.
 */
const endpointWithSecretDtoSchema = endpointDtoSchema.extend({
  secret: z.string(),
});

const deliveryDtoSchema = z.object({
  id: z.string(),
  /** The send this attempt belongs to; retries of one batch share it. */
  dispatch_id: z.string(),
  attempt: z.number().int(),
  event_count: z.number().int(),
  outcome: z.enum(["success", "retryable", "terminal", "pending"]),
  response_status: z.number().int().nullable(),
  latency_ms: z.number().int().nullable(),
  error: z.string().nullable(),
  fired_at: z.string(),
});

const healthDtoSchema = z.object({
  status: endpointStatusSchema,
  disabled_reason: z.string().nullable(),
  failing_since: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
  /** Null when everything produced has been delivered. */
  oldest_undelivered_age_ms: z.number().int().nullable(),
  dlq_depth: z.number().int(),
  sends_per_minute: z.number(),
  /** Delivered over attempted in the last hour; null with no attempts. */
  success_rate: z.number().nullable(),
  p95_latency_ms: z.number().int().nullable(),
});

const eventTypeDtoSchema = z.object({
  type: z.string(),
  family: z.string(),
  schema_version: z.string(),
  is_emitting: z.boolean(),
  description: z.string(),
});

/**
 * One emitted event, the SAME envelope the signed deliveries carry, so a
 * pull and a receiver parse with one reader. `data` is the per-type business
 * payload and stays an open object: every family carries its own cut, and a
 * closed shape here would describe only one of them.
 */
const webhookEventEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.string(),
  schema_version: z.string(),
  data: z.record(z.string(), z.unknown()),
});

/**
 * A test fire's outcome. `response_body` carries the receiver's answer,
 * truncated, when one arrived; `error` replaces it with `response_status`
 * null when the delivery never reached a receiver at all.
 */
const testFireResultSchema = z.object({
  delivered: z.boolean(),
  response_status: z.number().int().nullable(),
  response_body: z.string().optional(),
  error: z.string().optional(),
});

/** The paging half of every cursor-paged list on this surface. */
const nextCursorSchema = z
  .string()
  .nullable()
  .describe(
    "Pass back as `cursor` for the next page. Null means the walk is exhausted; a full page does NOT mean there is more.",
  );

/** One documented 200, in this family's canonical envelope for errors. */
function okResponse(description: string, schema: z.ZodTypeAny) {
  return {
    ...canonicalBaseResponses,
    200: {
      description,
      content: { "application/json": { schema: resolver(schema) } },
    },
  };
}

/** The refusal every route that names an endpoint or an event can answer. */
const notFoundResponse = {
  404: {
    description: "Not Found",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

const logger = createLogger("langwatch:webhooks:rest");

/** The single-envelope batch a test fire sends. */
function testFireBody(now: Date): string {
  return JSON.stringify({
    batch: [
      {
        id: `evt_test_${randomUUID()}`,
        type: "test.ping",
        created: now.toISOString(),
        schema_version: "1",
        data: { message: "LangWatch webhook test delivery" },
      },
    ],
  });
}

/** Record a test fire's outcome. The test itself ran, so a delivery-log
 *  hiccup must not convert the documented 200-with-result contract into a
 *  500. */
async function recordTestFire(attempt: {
  organizationId: string;
  endpointId: string;
  dispatchId: string;
  outcome: "success" | "terminal";
  responseStatus?: number;
  error?: string;
}): Promise<void> {
  try {
    await endpoints.recordDeliveryAttempt({
      ...attempt,
      attempt: 1,
      eventCount: 1,
    });
  } catch (logError) {
    logger.warn({ error: logError }, "test-fire delivery log write failed");
  }
}

const secured = createOrgApp({
  basePath: "/api/webhooks/v1",
  errorEnvelope: "canonical",
});

secured.hono.onError(handleWebhookApiError);

secured.access(requires("webhookEndpoints:manage")).post(
  "/endpoints",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "Create a webhook endpoint",
    description:
      "Create a webhook endpoint. The signing secret is returned ONCE in this response and never again; roll it to get a new one. Send `Idempotency-Key` to make a retry safe: a replay returns the original response including its `secret`, which is the only way to recover a secret whose response was lost in transit.",
    parameters: [idempotencyKeyParameter],
    responses: {
      ...canonicalBaseResponses,
      ...canonicalConflictResponses,
      201: {
        description:
          "The endpoint, with the signing secret this body alone carries",
        headers: idempotentReplayHeaders,
        content: {
          "application/json": {
            schema: resolver(z.object({ data: endpointWithSecretDtoSchema })),
          },
        },
      },
    },
  }),
  zValidator("json", createEndpointSchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const body = c.req.valid("json");
    // Scoped to the organization, not a project: this family authenticates at
    // the org, so that is the tenancy a key is unique within.
    const outcome = await withIdempotency({
      prisma,
      operation: "webhooks.v1.endpoints.create",
      scopeId: organization.id,
      key: readIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER)),
      validatedBody: body,
      handler: async () => {
        const { endpoint, secret } = await endpoints.create({
          organizationId: organization.id,
          url: body.url,
          enabledEvents: body.enabled_events,
          maxBatchSize: body.max_batch_size,
          maxBatchDelayMs: body.max_batch_delay_ms,
          maxInFlight: body.max_in_flight,
        });
        return {
          status: 201,
          body: { data: { ...endpointResponse(endpoint), secret } },
        };
      },
    });
    return idempotentJson({ c, outcome });
  },
);

secured.access(requires("webhookEndpoints:view")).get(
  "/endpoints",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "List webhook endpoints",
    description: "List the organization's webhook endpoints",
    responses: okResponse(
      "Every endpoint the organization has, archived ones excluded",
      z.object({ data: z.array(endpointDtoSchema) }),
    ),
  }),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const list = await endpoints.getAll({ organizationId: organization.id });
    return c.json({ data: list.map(endpointResponse) });
  },
);

secured.access(requires("webhookEndpoints:view")).get(
  "/endpoints/:id",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "Get a webhook endpoint",
    description: "Get one webhook endpoint",
    responses: {
      ...okResponse("The endpoint", z.object({ data: endpointDtoSchema })),
      ...notFoundResponse,
    },
  }),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const endpoint = await endpoints.getById({
      organizationId: organization.id,
      endpointId: c.req.param("id"),
    });
    return c.json({ data: endpointResponse(endpoint) });
  },
);

secured.access(requires("webhookEndpoints:manage")).patch(
  "/endpoints/:id",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "Update a webhook endpoint",
    description:
      "Update a webhook endpoint's url, event subscriptions, or status (`active` re-enables, `disabled` pauses; re-enabling does not re-send the gap, replay covers it)",
    responses: {
      ...okResponse(
        "The endpoint as it now stands",
        z.object({ data: endpointDtoSchema }),
      ),
      ...notFoundResponse,
    },
  }),
  zValidator("json", updateEndpointSchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const endpointId = c.req.param("id");
    const body = c.req.valid("json");

    const hasFieldUpdate =
      body.url !== undefined ||
      body.enabled_events !== undefined ||
      body.max_batch_size !== undefined ||
      body.max_batch_delay_ms !== undefined ||
      body.max_in_flight !== undefined;
    let endpoint = hasFieldUpdate
      ? await endpoints.update({
          organizationId: organization.id,
          endpointId,
          url: body.url,
          enabledEvents: body.enabled_events,
          maxBatchSize: body.max_batch_size,
          maxBatchDelayMs: body.max_batch_delay_ms,
          maxInFlight: body.max_in_flight,
        })
      : await endpoints.getById({
          organizationId: organization.id,
          endpointId,
        });
    const requestedStatus = body.status && toStoredEnum(body.status);
    if (requestedStatus === "DISABLED" && endpoint.status === "ACTIVE") {
      endpoint = await endpoints.disable({
        organizationId: organization.id,
        endpointId,
      });
    } else if (requestedStatus === "ACTIVE" && endpoint.status === "DISABLED") {
      endpoint = await endpoints.enable({
        organizationId: organization.id,
        endpointId,
      });
    }
    return c.json({ data: endpointResponse(endpoint) });
  },
);

secured.access(requires("webhookEndpoints:manage")).delete(
  "/endpoints/:id",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "Archive a webhook endpoint",
    description: "Archive a webhook endpoint",
    responses: {
      ...okResponse(
        "Archived: the endpoint is gone from every read and delivers nothing",
        z.object({ data: z.object({ archived: z.literal(true) }) }),
      ),
      ...notFoundResponse,
    },
  }),
  async (c) => {
    const organization = c.get("organization") as Organization;
    await endpoints.archive({
      organizationId: organization.id,
      endpointId: c.req.param("id"),
    });
    return c.json({ data: { archived: true } });
  },
);

secured.access(requires("webhookEndpoints:manage")).post(
  "/endpoints/:id/roll-secret",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "Roll an endpoint's signing secret",
    description:
      "Roll the endpoint's signing secret. The new secret is returned ONCE; deliveries sign with it immediately.",
    responses: {
      ...okResponse(
        "The endpoint, with the new signing secret this body alone carries",
        z.object({ data: endpointWithSecretDtoSchema }),
      ),
      ...notFoundResponse,
    },
  }),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const { endpoint, secret } = await endpoints.rollSecret({
      organizationId: organization.id,
      endpointId: c.req.param("id"),
    });
    return c.json({ data: { ...endpointResponse(endpoint), secret } });
  },
);

secured.access(requires("webhookEndpoints:manage")).post(
  "/endpoints/:id/test",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "Send a test event to an endpoint",
    description:
      "Send a signed test event through the full delivery path. Contract: the route answers 200 whenever the test itself ran; data.delivered says whether the receiver accepted it, so clients must read the body, not the status code.",
    responses: {
      ...okResponse(
        "The test ran; `data.delivered` carries the receiver's verdict",
        z.object({ data: testFireResultSchema }),
      ),
      ...notFoundResponse,
    },
  }),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const endpointId = c.req.param("id");
    const endpoint = await endpoints.getById({
      organizationId: organization.id,
      endpointId,
    });
    const secrets = await endpoints.getSigningSecrets({
      organizationId: organization.id,
      endpointId,
    });
    const dispatchId = `test:${randomUUID()}`;
    try {
      const result = await sendWebhook({
        url: endpoint.url,
        body: testFireBody(new Date()),
        triggerName: endpointId,
        contextLabel: `Webhook endpoint ${endpointId} (test)`,
        testFire: true,
        eventId: dispatchId,
        dispatchIdHeader: WEBHOOK_DELIVERY_ID_HEADER,
        signingSecrets: secrets,
        attempt: 1,
        // The test button has to reach exactly what real delivery reaches. It
        // did not: real delivery passes this flag and the test send did not,
        // so on an install running the escape hatch a local endpoint delivered
        // fine and its own test said the address was blocked.
        allowInsecureLocal: allowsInsecureLocalUrls(),
      });
      const delivered = result.status >= 200 && result.status < 300;
      await recordTestFire({
        organizationId: organization.id,
        endpointId,
        dispatchId,
        outcome: delivered ? "success" : "terminal",
        responseStatus: result.status,
      });
      return c.json({
        data: {
          delivered,
          response_status: result.status,
          response_body: result.body.slice(0, 500),
        },
      });
    } catch (error) {
      // The full message goes to the delivery log for the operator; the
      // response carries a sanitized summary so internal dispatch wording
      // and transport details never reach the caller verbatim.
      await recordTestFire({
        organizationId: organization.id,
        endpointId,
        dispatchId,
        outcome: "terminal",
        error:
          error instanceof Error ? error.message.slice(0, 500) : String(error),
      });
      return c.json({
        data: {
          delivered: false,
          response_status: null,
          error:
            "The test delivery could not reach the receiver; see the endpoint's delivery log for details.",
        },
      });
    }
  },
);

secured.access(requires("webhookEndpoints:view")).get(
  "/endpoints/:id/deliveries",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "List an endpoint's delivery attempts",
    description:
      "The endpoint's delivery log: every attempt with the receiver's HTTP status, latency, and error",
    responses: {
      ...okResponse(
        "One page of delivery attempts, newest first",
        z.object({
          data: z.array(deliveryDtoSchema),
          next_cursor: nextCursorSchema,
        }),
      ),
      ...notFoundResponse,
    },
  }),
  zValidator("query", deliveriesQuerySchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const { limit } = c.req.valid("query");
    const cursorParam = c.req.valid("query").cursor;
    let cursor: { firedAt: Date; id: string } | undefined;
    if (cursorParam) {
      const [firedAtMs, id] = cursorParam.split("~");
      const parsedMs = Number(firedAtMs);
      if (!Number.isInteger(parsedMs) || !id) {
        throw new BadRequestError("invalid cursor");
      }
      cursor = { firedAt: new Date(parsedMs), id };
    }
    const page = await endpoints.getDeliveries({
      organizationId: organization.id,
      endpointId: c.req.param("id"),
      limit,
      cursor,
    });
    return c.json({
      next_cursor: page.nextCursor
        ? `${page.nextCursor.firedAt.getTime()}~${page.nextCursor.id}`
        : null,
      data: page.deliveries.map((r) => ({
        id: r.id,
        dispatch_id: r.dispatchId,
        attempt: r.attempt,
        event_count: r.eventCount,
        outcome: r.outcome,
        response_status: r.responseStatus,
        latency_ms: r.latencyMs,
        error: r.error,
        fired_at: r.firedAt.toISOString(),
      })),
    });
  },
);

secured.access(requires("webhookEndpoints:view")).get(
  "/endpoints/:id/health",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "Read an endpoint's delivery health",
    description:
      "Delivery health. The headline number is oldest_undelivered_age_ms, the feed's staleness: age of the oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends/min, success rate, and p95 latency over the last hour.",
    responses: {
      ...okResponse(
        "The endpoint's delivery health",
        z.object({ data: healthDtoSchema }),
      ),
      ...notFoundResponse,
    },
  }),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const report = await health.health({
      organizationId: organization.id,
      endpointId: c.req.param("id"),
    });
    return c.json({
      data: {
        status: toWireEnum(report.status),
        disabled_reason: report.disabledReason,
        failing_since: report.failingSince?.toISOString() ?? null,
        last_success_at: report.lastSuccessAt?.toISOString() ?? null,
        last_failure_at: report.lastFailureAt?.toISOString() ?? null,
        oldest_undelivered_age_ms: report.oldestUndeliveredAgeMs,
        dlq_depth: report.dlqDepth,
        sends_per_minute: report.sendsPerMinute,
        success_rate: report.successRate,
        p95_latency_ms: report.p95LatencyMs,
      },
    });
  },
);

secured.access(requires("webhookEndpoints:view")).get(
  "/event-types",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "List subscribable event types",
    description:
      "The event catalog: every subscribable type, grouped by family; types marked emitting=false are declared contracts whose producers have not shipped yet",
    responses: okResponse(
      "Every subscribable event type",
      z.object({ data: z.array(eventTypeDtoSchema) }),
    ),
  }),
  async (c) => {
    return c.json({
      data: WEBHOOK_EVENT_TYPES.map((t) => ({
        type: t.type,
        family: t.family,
        schema_version: t.schemaVersion,
        is_emitting: t.isEmitting,
        description: t.description,
      })),
    });
  },
);

secured.access(requires("webhookEndpoints:view")).get(
  "/events",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "List emitted events",
    description:
      "The organization's emitted-events log for the request families: cursor-paged, newest first, filter by type. `from` and `to` bound the created range in epoch milliseconds and are REQUIRED, because the log is a ranged read over the 13-month spend table and an unbounded walk sorts all of it on every page. Webhooks are push over this log, never the only copy of it. SERVES `gateway.request.completed` and `gateway.request.settled` ONLY. The governance families (`gateway.budget.*`, `gateway.virtual_key.*`) are delivered by webhook but are not retained in a queryable log, so they cannot be listed or replayed here; any other type returns an empty page rather than an error, so a client can probe forward-compatibly.",
    responses: okResponse(
      "One page of emitted-event envelopes, newest first",
      z.object({
        data: z.array(webhookEventEnvelopeSchema),
        next_cursor: nextCursorSchema,
      }),
    ),
  }),
  zValidator("query", eventsQuerySchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const query = c.req.valid("query");
    // The service maps emitted types to row statuses and serves an empty
    // page for unknown types, so consumers can probe forward-compatibly
    // without an error.
    const page = await requireEventsService().getEmittedEvents({
      organizationId: organization.id,
      fromMs: query.from,
      toMs: query.to,
      cursor: query.cursor ?? null,
      limit: query.limit,
      types: query.type !== undefined ? [query.type] : undefined,
    });
    return c.json({ data: page.events, next_cursor: page.nextCursor });
  },
);

secured.access(requires("webhookEndpoints:view")).get(
  "/events/:id",
  requireWebhookPlan,
  describeRoute({
    tags: ["Webhooks"],
    summary: "Get one emitted event",
    description:
      "One emitted event by its id, as it was delivered. Serves the same families the events log serves. A 404 covers every reason the log cannot answer -- never emitted, past the retention horizon, or belonging to another organization -- because telling those apart would confirm the existence of another tenant's request ids.",
    responses: {
      ...okResponse(
        "The envelope, exactly as it was delivered",
        z.object({ data: webhookEventEnvelopeSchema }),
      ),
      ...notFoundResponse,
    },
  }),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const event = await requireEventsService().getEmittedEventById({
      organizationId: organization.id,
      id: c.req.param("id"),
    });
    if (!event) throw new WebhookEventNotFoundError();
    return c.json({ data: event });
  },
);

export const app = secured.hono;
