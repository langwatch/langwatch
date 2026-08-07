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
import { resolver } from "hono-openapi/zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createOrgApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { getApp } from "~/server/app-layer/app";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import { PrismaProcessStore } from "~/server/event-sourcing/process-manager/stores/prismaProcessStore";
import { applicableEndUserCaps } from "~/server/gateway/endUserCaps.service";
import {
  decodeSpendEventsCursor,
  decodeSpendSummariesCursor,
  GatewaySpendEventsRepository,
} from "~/server/gateway/spendEvents.clickhouse.repository";
import {
  spendFilterQueryShape,
  spendFiltersFromQuery,
} from "~/server/gateway/spendFilters";
import {
  assertGroupingIsWalkable,
  MAX_GROUP_BY_KEYS,
  SPEND_BUCKETS,
  SPEND_GROUP_BY_KEYS,
  type SpendGroupByKey,
} from "~/server/gateway/spendGrouping";
import { resolveSpendScope } from "~/server/gateway/spendScope";
import { USD_DISPLAY_STRING_FORMAT } from "~/server/gateway/wireMoney";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { canonicalBaseResponses } from "../../shared/base-responses";
import { BadRequestError, ForbiddenError } from "../../shared/errors";
import {
  END_USER_SPEND_DESCRIPTION,
  SPEND_EVENTS_PULL_DESCRIPTION,
  SPEND_SUMMARIES_DESCRIPTION,
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
    ...spendFilterQueryShape,
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

// ── Response DTO schemas (used by describeRoute for OpenAPI gen) ────────
// These mirror the shapes the handlers below return. Without them the
// generated spec documents these routes with `responses: {}`, so a caller
// reading the spec learns the route exists and nothing about what it answers.

const usageSchema = z.object({
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_read_input_tokens: z.number().int(),
  cache_creation_input_tokens: z.number().int(),
  reasoning_tokens: z.number().int(),
});

/** Money is published twice: a display string and the canonical integer. */
const costSchema = z.object({
  total_usd: z
    .string()
    .describe(
      `Display value. ${USD_DISPLAY_STRING_FORMAT} Use nano_usd for arithmetic.`,
    ),
  nano_usd: z
    .number()
    .int()
    .describe(
      "Canonical integer cost, nano-USD. Rated as an integer and summed as one, so this is the figure to reconcile against.",
    ),
});

/** Null when the walk is exhausted. A full page does NOT imply more. */
const nextCursorSchema = z.string().nullable();

const spendSummaryRowSchema = z.object({
  /** The first grouping dimension's value, unchanged from when a rollup could
   *  only be grouped one way. Read `group` to tell two dimensions apart. */
  key: z.string(),
  /** Every grouping dimension by name, e.g. `{ "model": "gpt-5-mini" }`. */
  group: z.record(z.string()),
  /** Start of the time bucket in the requested timezone, null when unbucketed. */
  bucket_start: z.string().nullable(),
  event_count: z.number().int(),
  settled_count: z.number().int(),
  usage: usageSchema,
  cost: costSchema,
});

/**
 * One billing envelope, the SAME shape the signed webhooks deliver, so a
 * reconciliation pull and a webhook receiver parse with one reader.
 */
const spendEventEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.string(),
  schema_version: z.string(),
  data: z
    .object({
      event_id: z.string(),
      event_type: z.string(),
      /** The join key across the settled/completed pair. */
      gateway_request_id: z.string(),
      occurred_at: z.string(),
      // Null on rows whose quantities are not known yet (admitted) or no
      // longer authoritative (settled).
      usage: usageSchema.nullable(),
      cost: costSchema.nullable(),
      status: z.string(),
      needs_reconciliation: z.boolean().nullable(),
      settle_reason: z.string().nullable(),
      error: z
        .object({
          class: z.string(),
          http_status: z.number().int().nullable(),
        })
        .nullable(),
      duration_ms: z.number().int().nullable(),
      labels: z.array(z.string()),
      metadata: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
});

const endUserCapSchema = z.object({
  budget_id: z.string(),
  anchor_id: z.string(),
  window: z.string(),
  on_breach: z.enum(["block", "warn"]),
  limit_usd: z
    .string()
    .describe(`The cap for this end user. ${USD_DISPLAY_STRING_FORMAT}`),
  spent_usd: z
    .string()
    .describe(`Spend against that cap. ${USD_DISPLAY_STRING_FORMAT}`),
  period_started_at: z.string(),
});

const endUserSpendSchema = z.object({
  end_user_id: z.string(),
  window: z.string(),
  from: z.string(),
  to: z.string(),
  cost: costSchema,
  request_count: z.number().int(),
  usage: usageSchema,
  caps: z.array(endUserCapSchema),
});

const replayResultSchema = z.object({
  endpoint_id: z.string(),
  replay_id: z.string(),
  replayed: z.number().int(),
  window: z.object({ from: z.string(), to: z.string() }),
});

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

const secured = createOrgApp({
  basePath: "/api/gateway/v1",
  errorEnvelope: "canonical",
});

secured.hono.onError(handleGatewaySpendApiError);

/**
 * One to two dimensions, comma-separated. Two is the ceiling because a third
 * multiplies the group count past what a single cursor walk serves at a
 * useful page size, and a caller who wants a third is really asking for the
 * events read.
 */
/**
 * One or two dimensions, comma separated.
 *
 * Validated inside the transform rather than piped into an array schema so a
 * refusal names `group_by` and not `group_by.0`. The caller sent one string;
 * an index they never wrote maps onto nothing a client can point at, and
 * `meta.fields` exists precisely so a client can point at something.
 */
const groupBySchema = z.string().transform((raw, ctx): SpendGroupByKey[] => {
  const keys = raw.split(",").map((part) => part.trim());
  const refuse = (message: string): typeof z.NEVER => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    return z.NEVER;
  };
  const unknown = keys.filter(
    (key) => !SPEND_GROUP_BY_KEYS.includes(key as SpendGroupByKey),
  );
  if (unknown.length > 0) {
    return refuse(
      `group_by must name one or two of ${SPEND_GROUP_BY_KEYS.join(", ")}`,
    );
  }
  if (keys.length > MAX_GROUP_BY_KEYS) {
    return refuse(`group_by takes at most ${MAX_GROUP_BY_KEYS} dimensions`);
  }
  if (new Set(keys).size !== keys.length) {
    return refuse("group_by cannot repeat a dimension");
  }
  return keys as SpendGroupByKey[];
});

const spendSummariesQuerySchema = z
  .object({
    group_by: groupBySchema,
    bucket: z.enum(SPEND_BUCKETS).optional().default("none"),
    // An IANA zone, because a day boundary is the caller's local midnight and
    // re-bucketing UTC days afterwards cannot recover the requests that fell
    // on the other side of it.
    timezone: z.string().min(1).max(64).optional().default("UTC"),
    allow_unstable: z.coerce.boolean().optional().default(false),
    from: z.coerce.number().int().positive(),
    to: z.coerce.number().int().positive(),
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().positive().max(1000).optional().default(500),
    ...spendFilterQueryShape,
  })
  // An inverted window is an empty window, so a caller who swapped the two
  // reads a confident zero and reconciles against it. /spend-events has
  // refused this since it shipped; this surface answered instead.
  .refine((q) => q.from <= q.to, {
    message: "from must be less than or equal to to",
  });

secured.access(requires("gatewaySpend:view")).get(
  "/spend-summaries",
  requireBillingPlan,
  describeRoute({
    responses: okResponse(
      "Per-key spend rollups",
      z.object({
        data: z.array(spendSummaryRowSchema),
        next_cursor: nextCursorSchema,
      }),
    ),
    tags: ["Gateway Spend"],
    summary: "List spend summaries",
    description: SPEND_SUMMARIES_DESCRIPTION,
  }),
  zValidator("query", spendSummariesQuerySchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const query = c.req.valid("query");
    // Same contract as /spend-events: a present-but-garbled cursor is refused
    // rather than silently restarting the walk from the first key.
    if (
      query.cursor !== undefined &&
      decodeSpendSummariesCursor(query.cursor) === null
    ) {
      throw new BadRequestError("Invalid cursor.");
    }
    assertGroupingIsWalkable({
      keys: query.group_by,
      bucket: query.bucket,
      toMs: query.to,
      nowMs: Date.now(),
      allowUnstable: query.allow_unstable,
    });
    const scope = await resolveSpendScope({
      organizationId: organization.id,
      projectIds: query.project_id,
      teamIds: query.team_id,
      externalIds: query.external_id,
    });
    const page = await spendEvents.readSpendSummaries({
      tenantIds: scope.tenantIds,
      groupBy: query.group_by,
      bucket: query.bucket,
      timezone: query.timezone,
      fromMs: query.from,
      toMs: query.to,
      cursor: query.cursor ?? null,
      limit: query.limit,
      filters: spendFiltersFromQuery(query, {
        virtualKeyIds: scope.virtualKeyIds,
      }),
    });
    return c.json({
      data: page.rows.map((r) => ({
        key: r.key,
        group: r.group,
        bucket_start: r.bucketStart,
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
      next_cursor: page.nextCursor,
    });
  },
);

secured.access(requires("gatewaySpend:view")).get(
  "/spend-events",
  requireBillingPlan,
  describeRoute({
    tags: ["Gateway Spend"],
    summary: "List spend events",
    description: SPEND_EVENTS_PULL_DESCRIPTION,
    responses: okResponse(
      "One page of billing envelopes",
      z.object({
        data: z.array(spendEventEnvelopeSchema),
        next_cursor: nextCursorSchema,
      }),
    ),
  }),
  zValidator("query", spendEventsQuerySchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const query = c.req.valid("query");
    // A present-but-garbled cursor is a caller bug: refusing beats
    // silently restarting the walk, which would re-serve the whole range.
    if (query.cursor !== undefined && !decodeSpendEventsCursor(query.cursor)) {
      throw new BadRequestError("Invalid cursor.");
    }
    const scope = await resolveSpendScope({
      organizationId: organization.id,
      projectIds: query.project_id,
      teamIds: query.team_id,
      externalIds: query.external_id,
    });
    const page = await spendEvents.walkSpendEvents({
      tenantIds: scope.tenantIds,
      fromMs: query.from,
      toMs: query.to,
      cursor: query.cursor ?? null,
      limit: query.limit,
      filters: spendFiltersFromQuery(query, {
        virtualKeyIds: scope.virtualKeyIds,
      }),
    });
    return c.json({
      data: page.rows.map(spendRowToEnvelope),
      next_cursor: page.nextCursor,
    });
  },
);

secured.access(requires("gatewaySpend:view")).get(
  "/end-users/:id/spend",
  requireBillingPlan,
  describeRoute({
    tags: ["Gateway Spend"],
    summary: "Read one end user's spend",
    description: END_USER_SPEND_DESCRIPTION,
    responses: okResponse(
      "Spend and standing for one end user",
      z.object({ data: endUserSpendSchema }),
    ),
  }),
  zValidator("query", endUserSpendQuerySchema),
  async (c) => {
    const organization = c.get("organization") as Organization;
    const endUserId = c.req.param("id");
    const query = c.req.valid("query");
    const now = Date.now();
    const fromMs = query.from ?? now - END_USER_WINDOWS[query.window];
    const toMs = query.to ?? now;
    const { tenantIds } = await resolveSpendScope({
      organizationId: organization.id,
    });
    const rollup = await spendEvents.readEndUserSpend({
      tenantIds,
      endUserId,
      fromMs,
      toMs,
      virtualKeyId: query.virtual_key_id,
    });
    const caps = await applicableEndUserCaps({
      prisma,
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

secured.access(requires("gatewaySpend:manage")).post(
  "/spend-events/replay",
  requireBillingPlan,
  describeRoute({
    tags: ["Gateway Spend"],
    summary: "Replay spend events to an endpoint",
    description: REPLAY_DESCRIPTION,
    responses: okResponse(
      "Replay accepted",
      z.object({ data: replayResultSchema }),
    ),
  }),
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
      prisma,
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
