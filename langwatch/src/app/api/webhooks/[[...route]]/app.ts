import { randomUUID } from "node:crypto";
import {
  assertWebhookEndpointsEntitled,
  WebhookEndpointsNotEntitledError,
} from "@ee/webhooks/entitlement";
import { WEBHOOK_EVENT_TYPES } from "@ee/webhooks/eventRegistry";
import {
  WebhookEndpointService,
  allowsInsecureLocalUrls,
} from "@ee/webhooks/webhookEndpoint.service";
import { createLogger } from "@langwatch/observability";
import { WebhookEventsClickHouseRepository } from "@ee/webhooks/webhookEvents.clickhouse.repository";
import { WebhookEventsService } from "@ee/webhooks/webhookEvents.service";
import { WebhookHealthService } from "@ee/webhooks/webhookHealth.service";
import type { Organization } from "@prisma/client";
import type { Context, Next } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { createOrgApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { sendWebhook } from "~/server/app-layer/automations/delivery/sendWebhook";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import { PrismaProcessStore } from "~/server/event-sourcing/process-manager/stores/prismaProcessStore";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { ForbiddenError } from "../../shared/errors";
import { handleWebhookApiError } from "./error-handler";

patchZodOpenapi();

const endpoints = new WebhookEndpointService({ prisma });
const health = new WebhookHealthService({
  prisma,
  endpoints,
  processStore: new PrismaProcessStore(prisma),
});
const eventsRepository = new WebhookEventsClickHouseRepository(
  async (tenantId) => {
    const client = await getClickHouseClientForProject(tenantId);
    if (!client) throw new Error("ClickHouse is not configured");
    return client;
  },
);
const eventsService = new WebhookEventsService({
  prisma,
  repository: eventsRepository,
});

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
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  ...deliveryControlsSchema,
});

const deliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

const eventsQuerySchema = z.object({
  type: z.string().min(1).max(200).optional(),
  from: z.coerce.number().int().positive().optional(),
  to: z.coerce.number().int().positive().optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
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
    status: endpoint.status,
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

const logger = createLogger("langwatch:webhooks:rest");

const secured = createOrgApp({ basePath: "/api/webhooks/v1" });

secured.hono.onError(handleWebhookApiError);

secured.access(requires("webhookEndpoints:manage")).post(
  "/endpoints",
  requireWebhookPlan,
  describeRoute({
    description:
      "Create a webhook endpoint. The signing secret is returned ONCE in this response and never again; roll it to get a new one.",
  }),
  zValidator("json", createEndpointSchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const body = c.req.valid("json");
    const { endpoint, secret } = await endpoints.create({
      organizationId: organization.id,
      url: body.url,
      enabledEvents: body.enabled_events,
      maxBatchSize: body.max_batch_size,
      maxBatchDelayMs: body.max_batch_delay_ms,
      maxInFlight: body.max_in_flight,
    });
    return c.json({ data: { ...endpointResponse(endpoint), secret } }, 201);
  },
);

secured
  .access(requires("webhookEndpoints:view"))
  .get(
    "/endpoints",
    requireWebhookPlan,
    describeRoute({ description: "List the organization's webhook endpoints" }),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const list = await endpoints.getAll({ organizationId: organization.id });
      return c.json({ data: list.map(endpointResponse) });
    },
  );

secured
  .access(requires("webhookEndpoints:view"))
  .get(
    "/endpoints/:id",
    requireWebhookPlan,
    describeRoute({ description: "Get one webhook endpoint" }),
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
    description:
      "Update a webhook endpoint's url, event subscriptions, or status (ACTIVE re-enables, DISABLED pauses; re-enabling does not re-send the gap, replay covers it)",
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
    if (body.status === "DISABLED" && endpoint.status === "ACTIVE") {
      endpoint = await endpoints.disable({
        organizationId: organization.id,
        endpointId,
      });
    } else if (body.status === "ACTIVE" && endpoint.status === "DISABLED") {
      endpoint = await endpoints.enable({
        organizationId: organization.id,
        endpointId,
      });
    }
    return c.json({ data: endpointResponse(endpoint) });
  },
);

secured
  .access(requires("webhookEndpoints:manage"))
  .delete(
    "/endpoints/:id",
    requireWebhookPlan,
    describeRoute({ description: "Archive a webhook endpoint" }),
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
    description:
      "Roll the endpoint's signing secret. The new secret is returned ONCE; deliveries sign with it immediately.",
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
    description:
      "Send a signed test event through the full delivery path. Contract: the route answers 200 whenever the test itself ran; data.delivered says whether the receiver accepted it, so clients must read the body, not the status code.",
  }),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const endpointId = c.req.param("id");
    const endpoint = await endpoints.getById({
      organizationId: organization.id,
      endpointId,
    });
    const secret = await endpoints.getSigningSecret({
      organizationId: organization.id,
      endpointId,
    });
    const now = new Date();
    const body = JSON.stringify({
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
    const dispatchId = `test:${randomUUID()}`;
    try {
      const result = await sendWebhook({
        url: endpoint.url,
        body,
        triggerName: endpointId,
        contextLabel: `Webhook endpoint ${endpointId} (test)`,
        testFire: true,
        eventId: dispatchId,
        signingSecret: secret,
        attempt: 1,
      });
      // The test ran; a delivery-log hiccup must not convert the
      // documented 200-with-result contract into a 500.
      try {
        await endpoints.recordDeliveryAttempt({
          organizationId: organization.id,
          endpointId,
          dispatchId,
          attempt: 1,
          eventCount: 1,
          outcome:
            result.status >= 200 && result.status < 300 ? "success" : "terminal",
          responseStatus: result.status,
        });
      } catch (logError) {
        logger.warn({ error: logError }, "test-fire delivery log write failed");
      }
      return c.json({
        data: {
          delivered: result.status >= 200 && result.status < 300,
          response_status: result.status,
          response_body: result.body.slice(0, 500),
        },
      });
    } catch (error) {
      // The full message goes to the delivery log for the operator; the
      // response carries a sanitized summary so internal dispatch wording
      // and transport details never reach the caller verbatim.
      // The test ran; a delivery-log hiccup must not convert the
      // documented 200-with-result contract into a 500.
      try {
        await endpoints.recordDeliveryAttempt({
          organizationId: organization.id,
          endpointId,
          dispatchId,
          attempt: 1,
          eventCount: 1,
          outcome: "terminal",
          error:
            error instanceof Error ? error.message.slice(0, 500) : String(error),
        });
      } catch (logError) {
        logger.warn({ error: logError }, "test-fire delivery log write failed");
      }
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
    description:
      "The endpoint's delivery log: every attempt with the receiver's HTTP status, latency, and error",
  }),
  zValidator("query", deliveriesQuerySchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const { limit } = c.req.valid("query");
    const rows = await endpoints.getDeliveries({
      organizationId: organization.id,
      endpointId: c.req.param("id"),
      limit,
    });
    return c.json({
      data: rows.map((r) => ({
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
    description:
      "Delivery health. The headline number is oldest_undelivered_age_ms, the feed's staleness: age of the oldest envelope still buffered or retrying. Also: DLQ depth, failure streak, sends/min, success rate, and p95 latency over the last hour.",
  }),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const report = await health.health({
      organizationId: organization.id,
      endpointId: c.req.param("id"),
    });
    return c.json({
      data: {
        status: report.status,
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
    description:
      "The event catalog: every subscribable type, grouped by family; types marked emitting=false are declared contracts whose producers have not shipped yet",
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
    description:
      "The organization's emitted-events log (Stripe /v1/events parity): cursor-paged, newest first, filter by type and created range. Webhooks are push over this log, never the only copy of it.",
  }),
  zValidator("query", eventsQuerySchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const query = c.req.valid("query");
    // The service maps emitted types to row statuses and serves an empty
    // page for unknown types, so consumers can probe forward-compatibly
    // without an error.
    const page = await eventsService.getEmittedEvents({
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

export const app = secured.hono;
