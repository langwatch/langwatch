import {
  assertWebhookEndpointsEntitled,
  WebhookEndpointsNotEntitledError,
} from "@ee/webhooks/entitlement";
import { spendRowToEnvelope } from "@ee/webhooks/envelope";
import { eventMatches } from "@ee/webhooks/eventRegistry";
import {
  appendReplayToEndpointStream,
  type SendBatchPayload,
  type WebhookDeliveryProcessDeps,
} from "@ee/webhooks/process-manager/webhookDelivery.process";
import {
  WebhookEndpointService,
  type WebhookEndpointView,
} from "@ee/webhooks/webhookEndpoint.service";
import { WebhookEventsClickHouseRepository } from "@ee/webhooks/webhookEvents.clickhouse.repository";
import { WebhookEventsService } from "@ee/webhooks/webhookEvents.service";
import type { Organization } from "@prisma/client";
import type { Context, Next } from "hono";
import { describeRoute } from "hono-openapi";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createOrgApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import { PrismaProcessStore } from "~/server/event-sourcing/process-manager/stores/prismaProcessStore";
import {
  bucketPeriodFloorMs,
  GatewayBudgetClickHouseRepository,
} from "~/server/gateway/budget.clickhouse.repository";
import {
  attributedUserBucketScopeId,
  bucketScopeIdFor,
} from "~/server/gateway/budgetResolution.service";
import {
  decodeSpendEventsCursor,
  GatewaySpendEventsRepository,
} from "~/server/gateway/spendEvents.clickhouse.repository";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { BadRequestError, ForbiddenError } from "../../shared/errors";
import {
  END_USER_SPEND_DESCRIPTION,
  SPEND_EVENTS_PULL_DESCRIPTION,
} from "./contract";
import { handleGatewaySpendApiError } from "./error-handler";

patchZodOpenapi();

const spendEvents = new GatewaySpendEventsRepository(async (tenantId) => {
  const client = await getClickHouseClientForProject(tenantId);
  if (!client) throw new Error("ClickHouse is not configured");
  return client;
});

/**
 * The billing reconciliation surface rides the webhook platform's plan flag
 * (ADR-072: "the spend-events pull API gates under the same flag"): pull and
 * push are two views of one enterprise capability.
 */
async function requireBillingPlan(c: Context, next: Next): Promise<void> {
  const organization = c.get("organization") as Organization;
  try {
    await assertWebhookEndpointsEntitled(organization.id);
  } catch (error) {
    if (error instanceof WebhookEndpointsNotEntitledError) {
      throw new ForbiddenError(
        "The billing events API is an enterprise feature; this organization's plan does not include it.",
      );
    }
    throw error;
  }
  await next();
}

const spendEventsQuerySchema = z
  .object({
    // The reconciliation pull is a RANGED read by contract: without bounds
    // the walk sorts the whole 13-month table under FINAL on every page.
    from: z.coerce.number().int().positive().safe(),
    to: z.coerce.number().int().positive().safe(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().positive().max(200).optional().default(50),
    virtual_key_id: z.string().min(1).max(100).optional(),
    end_user_id: z.string().min(1).max(256).optional(),
    project_id: z.string().min(1).max(100).optional(),
    model: z.string().min(1).max(200).optional(),
    status: z
      .enum(["success", "error", "admitted", "confirmed", "failed", "settled"])
      .optional(),
  })
  .refine((q) => q.from <= q.to, {
    message: "from must be less than or equal to to",
  });

const END_USER_WINDOWS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
} as const;

const endUserSpendQuerySchema = z.object({
  window: z.enum(["day", "week", "month"]).optional().default("month"),
  from: z.coerce.number().int().positive().optional(),
  to: z.coerce.number().int().positive().optional(),
  virtual_key_id: z.string().min(1).max(100).optional(),
});

/** The org's project ids, optionally narrowed to one the caller asked for. */
async function orgTenantIds(
  organizationId: string,
  projectId?: string,
): Promise<string[]> {
  // Ordered so downstream client routing by the first tenant is stable.
  const projects = await prisma.project.findMany({
    where: { team: { organizationId } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const ids = projects.map((p) => p.id);
  if (projectId !== undefined) {
    return ids.includes(projectId) ? [projectId] : [];
  }
  return ids;
}

/**
 * The applicable caps for one end user: every attributed-user template in
 * the org (optionally narrowed by anchor key), each with its CURRENT
 * PERIOD spend from the budget ledger, boundary-aware. This is the pair a
 * rebilling platform polls at period close; the usage rollup served
 * beside it is the billing-events view of the same user over the asked
 * window, so the two figures deliberately cover different periods.
 */
async function applicableEndUserCaps(params: {
  organizationId: string;
  endUserId: string;
  tenantIds: string[];
  virtualKeyId?: string;
}): Promise<Array<Record<string, unknown>>> {
  const { organizationId, endUserId, tenantIds, virtualKeyId } = params;
  const templates = await prisma.gatewayBudget.findMany({
    where: {
      organizationId,
      scopeType: "ATTRIBUTED_USER",
      archivedAt: null,
      ...(virtualKeyId ? { scopeId: virtualKeyId } : {}),
    },
  });
  if (templates.length === 0 || tenantIds.length === 0) return [];

  const boundaries = await prisma.gatewayBudgetBucketBoundary.findMany({
    where: {
      organizationId,
      budgetId: { in: templates.map((t) => t.id) },
    },
  });
  const boundaryByKey = new Map(
    boundaries.map((b) => [`${b.budgetId}:${b.bucketScopeId}`, b]),
  );
  const bucketFor = (t: (typeof templates)[number]) =>
    bucketScopeIdFor(t, attributedUserBucketScopeId(t.scopeId, endUserId));

  const budgetCH = new GatewayBudgetClickHouseRepository(async (projectId) => {
    const client = await getClickHouseClientForProject(projectId);
    if (!client) throw new Error("clickhouse unavailable");
    return client;
  });
  const targets = templates.map((t) => {
    const bucketScopeId = bucketFor(t);
    const bucketBoundary = boundaryByKey.get(`${t.id}:${bucketScopeId}`);
    return {
      budgetId: t.id,
      scope: t.scopeType,
      scopeId: bucketScopeId,
      window: t.window,
      match: "exact" as const,
      periodFloorMs: bucketPeriodFloorMs(t, bucketBoundary?.periodStartedAt),
    };
  });
  const spends = await budgetCH.getSpendForTargetsAcrossTenants(
    tenantIds,
    targets,
  );
  const spentByBudget = new Map(spends.map((sp) => [sp.budgetId, sp.spentUsd]));
  return templates.map((t) => {
    const bucketBoundary = boundaryByKey.get(`${t.id}:${bucketFor(t)}`);
    return {
      budget_id: t.id,
      anchor_id: t.scopeId,
      window: t.window,
      on_breach: t.onBreach,
      limit_usd: t.limitUsd.toString(),
      spent_usd: spentByBudget.get(t.id) ?? "0",
      period_started_at: (
        bucketBoundary?.periodStartedAt ?? t.currentPeriodStartedAt
      ).toISOString(),
    };
  });
}

const secured = createOrgApp({ basePath: "/api/gateway/v1" });

secured.hono.onError(handleGatewaySpendApiError);

const spendSummariesQuerySchema = z.object({
  group_by: z.enum(["virtual_key", "end_user"]),
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
  project_id: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional().default(500),
});

secured.access(requires("gatewaySpend:view")).get(
  "/spend-summaries",
  requireBillingPlan,
  describeRoute({
    description:
      "Reconciliation checksum fast path: per-key spend rollups grouped by virtual key or end user, with token classes and integer nano-USD cost. Settled (unpriced) requests are counted separately as settled_count and never included in cost sums. Diff individual items via /spend-events only when a checksum diverges.",
  }),
  zValidator("query", spendSummariesQuerySchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const query = c.req.valid("query");
    const tenantIds = await orgTenantIds(organization.id, query.project_id);
    const rows = await spendEvents.readSpendSummaries({
      tenantIds,
      groupBy: query.group_by,
      fromMs: query.from,
      toMs: query.to,
      limit: query.limit,
    });
    return c.json({
      data: rows.map((r) => ({
        key: r.key,
        event_count: r.eventCount,
        settled_count: r.settledCount,
        usage: {
          input_tokens: r.tokensInput,
          output_tokens: r.tokensOutput,
          cache_read_input_tokens: r.tokensCacheRead,
          cache_creation_input_tokens: r.tokensCacheWrite,
          reasoning_tokens: r.tokensReasoning,
        },
        cost: { total_usd: r.costUsd, nano_usd: r.costNanoUsd },
      })),
    });
  },
);

secured
  .access(requires("gatewaySpend:view"))
  .get(
    "/spend-events",
    requireBillingPlan,
    describeRoute({ description: SPEND_EVENTS_PULL_DESCRIPTION }),
    zValidator("query", spendEventsQuerySchema),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const query = c.req.valid("query");
      // A present-but-garbled cursor is a caller bug: refusing beats
      // silently restarting the walk, which would re-serve the whole range.
      if (
        query.cursor !== undefined &&
        !decodeSpendEventsCursor(query.cursor)
      ) {
        throw new BadRequestError("Invalid cursor.");
      }
      const tenantIds = await orgTenantIds(organization.id, query.project_id);
      const page = await spendEvents.walkSpendEvents({
        tenantIds,
        fromMs: query.from,
        toMs: query.to,
        cursor: query.cursor ?? null,
        limit: query.limit,
        virtualKeyId: query.virtual_key_id,
        endUserId: query.end_user_id,
        model: query.model,
        status: query.status,
      });
      return c.json({
        data: page.rows.map(spendRowToEnvelope),
        next_cursor: page.nextCursor,
      });
    },
  );

secured
  .access(requires("gatewaySpend:view"))
  .get(
    "/end-users/:id/spend",
    requireBillingPlan,
    describeRoute({ description: END_USER_SPEND_DESCRIPTION }),
    zValidator("query", endUserSpendQuerySchema),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const endUserId = c.req.param("id");
      const query = c.req.valid("query");
      const now = Date.now();
      const fromMs = query.from ?? now - END_USER_WINDOWS[query.window];
      const toMs = query.to ?? now;
      const tenantIds = await orgTenantIds(organization.id);
      const rollup = await spendEvents.readEndUserSpend({
        tenantIds,
        endUserId,
        fromMs,
        toMs,
        virtualKeyId: query.virtual_key_id,
      });
      const caps = await applicableEndUserCaps({
        organizationId: organization.id,
        endUserId,
        tenantIds,
        virtualKeyId: query.virtual_key_id,
      });
      return c.json({
        data: {
          end_user_id: endUserId,
          window: query.window,
          from: new Date(fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
          cost: { total_usd: rollup.spendUsd, nano_usd: rollup.spendNanoUsd },
          request_count: rollup.requestCount,
          usage: {
            input_tokens: rollup.tokensInput,
            output_tokens: rollup.tokensOutput,
            cache_read_input_tokens: rollup.tokensCacheRead,
            cache_creation_input_tokens: rollup.tokensCacheWrite,
            reasoning_tokens: rollup.tokensReasoning,
          },
          caps,
        },
      });
    },
  );

const REPLAY_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REPLAY_MAX_ENVELOPES = 10_000;
const REPLAY_PAGE_SIZE = 200;

/**
 * Walks the window counting only what this endpoint subscribes to, and
 * refuses the call as soon as the count passes the cap.
 *
 * This runs before a single envelope is queued. Replay exists to reach
 * past a consumer's dedup window, so enqueueing part of a window and then
 * answering with an error is the worst outcome available: the receiver
 * takes delivery of envelopes the caller was told never shipped, and the
 * natural retry mints a fresh replay id and ships them again.
 */
async function assertReplayWindowWithinCap({
  events,
  endpoint,
  organizationId,
  fromMs,
  toMs,
}: {
  events: WebhookEventsService;
  endpoint: WebhookEndpointView;
  organizationId: string;
  fromMs: number;
  toMs: number;
}): Promise<void> {
  let matching = 0;
  let cursor: string | null = null;
  do {
    const page = await events.getEmittedEvents({
      organizationId,
      fromMs,
      toMs,
      cursor,
      limit: REPLAY_PAGE_SIZE,
    });
    for (const envelope of page.events) {
      if (!eventMatches(endpoint.enabledEvents, envelope.type)) continue;
      matching++;
      if (matching > REPLAY_MAX_ENVELOPES) {
        throw new BadRequestError(
          `the window holds more than ${REPLAY_MAX_ENVELOPES} envelopes; narrow it`,
        );
      }
    }
    cursor = page.nextCursor;
  } while (cursor);
}

const replayBodySchema = z
  .object({
    from: z.number().int().positive().safe(),
    to: z.number().int().positive().safe(),
    endpoint_id: z.string().min(1).max(200),
  })
  .refine((b) => b.from <= b.to, {
    message: "from must be less than or equal to to",
  })
  .refine((b) => b.to - b.from <= REPLAY_MAX_WINDOW_MS, {
    message: "the replay window is capped at 7 days per call",
  });

/**
 * Appends every matching envelope in the window to the endpoint's live
 * delivery stream, and answers how many shipped.
 */
async function appendWindowToEndpointStream({
  events,
  endpoint,
  deliveryDeps,
  organizationId,
  fromMs,
  toMs,
  replayId,
}: {
  events: WebhookEventsService;
  endpoint: WebhookEndpointView;
  deliveryDeps: WebhookDeliveryProcessDeps;
  organizationId: string;
  fromMs: number;
  toMs: number;
  replayId: string;
}): Promise<number> {
  let replayed = 0;
  let cursor: string | null = null;
  do {
    const page = await events.getEmittedEvents({
      organizationId,
      fromMs,
      toMs,
      cursor,
      limit: REPLAY_PAGE_SIZE,
    });
    const matching = page.events.filter((envelope) =>
      eventMatches(endpoint.enabledEvents, envelope.type),
    );
    // The preflight cleared this window, but folds landing between the two
    // passes can still grow it. Ship up to the cap and stop there rather
    // than error out: the response reports what actually went out.
    const shippable = matching.slice(0, REPLAY_MAX_ENVELOPES - replayed);
    for (const envelope of shippable) {
      await appendReplayToEndpointStream({
        deps: deliveryDeps,
        organizationId,
        endpoint,
        envelope: envelope as SendBatchPayload["envelopes"][number],
        replayId,
      });
      replayed++;
    }
    cursor = shippable.length < matching.length ? null : page.nextCursor;
  } while (cursor);
  return replayed;
}

const REPLAY_DESCRIPTION =
  "Re-delivers the window's spend envelopes to ONE endpoint through the " +
  "normal delivery path (per-endpoint stream, retry ladder, delivery log), " +
  "honoring the endpoint's event subscriptions. Envelope ids are UNCHANGED: " +
  "your consumer's event-id dedup decides what a redelivery means. Mind your " +
  "downstream billing system's finite dedup window (Metronome 34 days, " +
  "Stripe 24h+): replaying older than that window can double-bill on your " +
  "side, so prefer pull-and-diff for old ranges. The window is capped at 7 " +
  "days and 10,000 envelopes per call; both caps are checked before any " +
  "delivery is queued, so a refused replay ships nothing.";

secured
  .access(requires("gatewaySpend:manage"))
  .post(
    "/spend-events/replay",
    requireBillingPlan,
    describeRoute({ description: REPLAY_DESCRIPTION }),
    zValidator("json", replayBodySchema),
    async (c) => {
      const organization = c.get("organization") as Organization;
      const body = c.req.valid("json");

      const endpoints = new WebhookEndpointService({ prisma });
      const endpoint = await endpoints.getDeliverable({
        organizationId: organization.id,
        endpointId: body.endpoint_id,
      });
      if (!endpoint) {
        throw new BadRequestError(
          "unknown or inactive endpoint for this organization",
        );
      }

      const events = new WebhookEventsService({
        prisma,
        repository: new WebhookEventsClickHouseRepository(async (tenantId) => {
          const client = await getClickHouseClientForProject(tenantId);
          if (!client) throw new Error("ClickHouse is not configured");
          return client;
        }),
      });
      const deliveryDeps: WebhookDeliveryProcessDeps = {
        processStore: new PrismaProcessStore(prisma),
        endpoints,
        getPlan: (organizationId) =>
          getApp().planProvider.getActivePlan({ organizationId }),
      };

      // One replay identity per call: it salts batch ids and inbox source
      // ids so redelivered envelopes cannot collide with their historical
      // batches; the ENVELOPE ids stay untouched.
      await assertReplayWindowWithinCap({
        events,
        endpoint,
        organizationId: organization.id,
        fromMs: body.from,
        toMs: body.to,
      });

      const replayId = nanoid(10);
      const replayed = await appendWindowToEndpointStream({
        events,
        endpoint,
        deliveryDeps,
        organizationId: organization.id,
        fromMs: body.from,
        toMs: body.to,
        replayId,
      });

      return c.json({
        data: {
          endpoint_id: endpoint.id,
          replay_id: replayId,
          replayed,
          window: {
            from: new Date(body.from).toISOString(),
            to: new Date(body.to).toISOString(),
          },
        },
      });
    },
  );

export const app = secured.hono;
