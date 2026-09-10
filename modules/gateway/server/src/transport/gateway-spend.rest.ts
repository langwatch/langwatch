/**
 * @see ADR-072 (pull gates under the same plan flag as push)
 * Billing reconciliation REST on `/api/gateway/v1`: cursor-paged spend pull, its
 * rollup fast path, one end user's standing, and webhook replay — two views of
 * one ledger, one canonical envelope, behind an organization credential.
 *
 * The family addresses itself literally: `/api/gateway/v1` is shared with the
 * virtual-key surface rather than owned, so each route's own path is the whole
 * address and no wildcard is claimed over the prefix.
 */
import { defineRestMiddleware, defineRestRouter } from "@langwatch/api/rest";
import {
  BadRequestError,
  canonicalBaseResponses,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/runtime-composition";
import { nanoid } from "nanoid";
import { z } from "zod";

import { GatewaySpendCursorAdapter } from "../adapters/gateway-spend-cursor.adapter.ts";
import {
  GatewaySpendFiltersAdapter,
  SPEND_SUMMARY_STATUS_DESCRIPTION,
  spendFilterQueryShape,
  spendSummaryStatusFilter,
} from "../adapters/gateway-spend-filters.adapter.ts";
import {
  GatewaySpendGroupingAdapter,
  MAX_GROUP_BY_KEYS,
} from "../adapters/gateway-spend-grouping.adapter.ts";
import {
  SPEND_BUCKETS,
  SPEND_GROUP_BY_KEYS,
  type SpendGroupByKey,
} from "../ports/gateway-spend-events.port.ts";
import type { GatewayBudgetSpend, GatewaySettlementPolicy } from "../app/gateway.infrastructure.ts";
import type { GatewaySpendEventsService } from "../services/gateway-spend-events.service.ts";
import { USD_DISPLAY_STRING_FORMAT } from "@langwatch/gateway-contract";
import { Temporal, nowInstant } from "@langwatch/time";

const spendCursors = GatewaySpendCursorAdapter.create();
const spendFilters = GatewaySpendFiltersAdapter.create();
const spendGrouping = GatewaySpendGroupingAdapter.create();

/** Pinned as constants: the 13-month window and dedup guidance are load-bearing for consumers. */
export const SPEND_EVENTS_PULL_DESCRIPTION =
  "Cursor-paged pull over the per-request spend record, ascending by insert order so rows folded late are never skipped by an in-flight cursor. Events are the same canonical objects webhook deliveries carry. Retention is a fixed 13 months, which bounds reconciliation and replay. When feeding a downstream biller, mind its dedup window (Metronome 34 days and Stripe meters 24h+ at the time of writing; both vendors own those numbers, so confirm the current one before you rely on it): re-pulling older ranges into a biller past its window can double-bill. Every filter here is accepted by /spend-summaries too, so a checksum that disagrees can be diffed on exactly the same narrowing; the one difference is `status=admitted`, which only this read answers, because an admitted request is still in flight and contributes no cost to a rollup. Repeat a filter to widen it (`model=a&model=b` matches either); name two different filters to narrow. `metadata` is written `key:value`, split on the first colon, and repeating a key widens that key. `team_id` and `external_id` name Postgres records and are resolved to the projects and keys they cover, so a team with no projects or an external id nobody minted answers with no spend rather than with everything.";

export const SPEND_SUMMARIES_DESCRIPTION =
  "Reconciliation checksum fast path: spend rollups with token classes and integer nano-USD cost. Settled (unpriced) requests are counted separately as settled_count and never included in cost sums. Diff individual items via /spend-events only when a checksum diverges. `group_by` takes one or two of virtual_key, end_user, project, model, provider, principal and request_type, comma-separated, and `bucket` adds an hour or day column in the `timezone` you name. `key` stays the first dimension's value for consumers written against the single-dimension surface; read `group` to tell two dimensions apart. Paged by group key ascending: follow next_cursor until it comes back null, because a page that is full does not mean the window held nothing more. Grouping by model or provider, or into time buckets, is refused with `gateway_spend_group_by_unstable` while the window is recent enough that outcomes can still arrive, because those groups can move under a page walk and the totals would double-count some requests and miss others; ask for an older range, or send `allow_unstable` when an approximate shape is enough. Every filter here is accepted by /spend-events too, and the reverse holds apart from `status=admitted`: a rollup sums the cost of requests past admission, so an admitted request has none to contribute and that narrowing is refused rather than answered with a zero. Ask /spend-events for those.";

export const END_USER_SPEND_DESCRIPTION =
  "Windowed spend rollup for one external end user across the organization (the /customer/info-style read a rebilling integration polls). `caps` lists every attributed-user budget that applies to this end user, each with its limit and the spend against it. It is an empty array until such a budget template applies, never null.";

/** One row of the spend ledger, as the events reader hands it over. */
type SpendLedgerRow = Awaited<
  ReturnType<GatewaySpendEventsService["walkSpendEvents"]>
>["rows"][number];

/**
 * One billing envelope in the canonical wire format — the SAME shape the
 * signed webhooks deliver, so a reconciliation pull and a webhook receiver
 * parse with one reader.
 */
export type GatewaySpendEnvelope = {
  id: string;
  type: string;
  created: string;
  schema_version: string;
  data: Record<string, unknown>;
};

/** A deliverable endpoint, reduced to what a replay reads off it. */
export type GatewaySpendWebhookEndpoint = {
  id: string;
  enabledEvents: readonly string[];
};

/** The endpoint registry a replay names its destination in. */
export type GatewaySpendWebhookEndpoints = {
  tryGetDeliverable(input: {
    organizationId: string;
    endpointId: string;
  }): Promise<GatewaySpendWebhookEndpoint | null>;
};

/** The emitted-envelope log a replay walks, one page at a time. */
export type GatewaySpendWebhookEvents = {
  getEmittedEvents(input: {
    organizationId: string;
    fromMs: number;
    toMs: number;
    cursor: string | null;
    limit: number;
  }): Promise<{ events: GatewaySpendEnvelope[]; nextCursor: string | null }>;
};

/** The live delivery path a replay appends to. */
export type GatewaySpendWebhookDelivery = {
  appendReplayToEndpointStream(input: {
    organizationId: string;
    endpoint: GatewaySpendWebhookEndpoint;
    envelope: GatewaySpendEnvelope;
    replayId: string;
  }): Promise<void>;
};

/**
 * The whole of what the four reconciliation routes ask the process for. The
 * webhook half is described structurally, not by name: it belongs to the
 * Enterprise webhook platform, which this core package may not depend on, so
 * the process binds the real implementations.
 */
export type GatewaySpendApp = Readonly<{
  /**
   * The ledger reads. Undefined on a deployment without ClickHouse, where
   * there are no figures to report at all — the routes refuse rather than
   * answering a reconciliation query with a confident zero.
   */
  spendEvents: GatewaySpendEventsService | undefined;
  /** The budget ledger the per-end-user caps are read against. */
  budgetSpend: GatewayBudgetSpend | undefined;

  /** The endpoint registry a replay names its destination in. */
  webhookEndpoints: GatewaySpendWebhookEndpoints;
  /** The emitted-envelope log a replay walks. */
  webhookEvents: GatewaySpendWebhookEvents | undefined;
  /** The live delivery path a replay appends to. */
  webhookDelivery: GatewaySpendWebhookDelivery | undefined;

  /**
   * One spend row rendered as the canonical billing envelope. The wire format
   * is the webhook platform's, and the pull and the push must answer the same
   * bytes, so the mapping arrives rather than being restated here.
   */
  spendEventEnvelope(row: SpendLedgerRow): GatewaySpendEnvelope;

  /** Selector grammar is the webhook platform's; a second reading here could disagree with push. */
  endpointAcceptsEvent(input: { enabledEvents: readonly string[]; eventType: string }): boolean;

  /**
   * How long after a request an outcome may still arrive, which is what makes
   * a recent grouping unstable under a page walk.
   */
  settlementPolicy: GatewaySettlementPolicy;

  /** Resolves Postgres filters to CH ids. A no-match resolves to EMPTY, never "unfiltered". */
  resolveSpendScope(input: {
    organizationId: string;
    projectIds?: string[];
    teamIds?: string[];
    externalIds?: string[];
  }): Promise<{ tenantIds: string[]; virtualKeyIds?: string[] }>;

  /** Every attributed-user budget that applies to one end user, with spend. */
  endUserCaps(input: {
    organizationId: string;
    endUserId: string;
    tenantIds: string[];
    virtualKeyId?: string;
    budgetRepository: GatewayBudgetSpend;
  }): Promise<Array<Record<string, unknown>>>;

  /**
   * The application's own refusal for "the store these figures live in is not
   * reachable". It carries the code and the status the boundary renders, and
   * naming it here would put a second taxonomy on the same failure.
   */
  spendStoreUnavailable(): Error;
}>;

export const GatewaySpendApi = moduleApi<GatewaySpendApp>("gateway");

/**
 * Whether the credential's organization holds the plan the billing events API
 * is sold under (ADR-072: pull and push are two views of one enterprise
 * capability). Bound by the apps/api mount to the deployment's plan lookup, and
 * resolved right before each handler — after authentication and after the
 * permission check, the ordering the pre-conversion per-route gate held.
 */
export const gatewaySpendBillingPlanGate = defineRestMiddleware(
  "gatewaySpendBillingPlanGate",
  z.object({}),
);

/** The ledger is the only store spend accrues in; without it we say so, not a zero. */
function requireSpendEvents(app: GatewaySpendApp): GatewaySpendEventsService {
  const service = app.spendEvents;
  if (!service) throw app.spendStoreUnavailable();
  return service;
}

/** Milliseconds, not seconds: a seconds epoch silently lands in 1970 and reads empty. */
const epochMs = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).meta({
  description:
    "Milliseconds since the Unix epoch, not seconds. An epoch in seconds is a valid integer here and answers for 1970, so a mismatched unit reads as an empty window rather than as an error.",
  example: 1782864000000,
});

const spendEventsQuerySchema = z
  .object({
    // The reconciliation pull is a RANGED read by contract: without bounds
    // the walk sorts the whole 13-month table under FINAL on every page.
    from: epochMs,
    to: epochMs,
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

const endUserSpendParamsSchema = z.object({ id: z.string().min(1) });

// ── Response DTO schemas ───────────────────────────────────────────────
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
    .describe(`Display value. ${USD_DISPLAY_STRING_FORMAT} Use nano_usd for arithmetic.`),
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
  group: z.record(z.string(), z.string()),
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
  limit_usd: z.string().describe(`The cap for this end user. ${USD_DISPLAY_STRING_FORMAT}`),
  spent_usd: z.string().describe(`Spend against that cap. ${USD_DISPLAY_STRING_FORMAT}`),
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

/** The refusals every route here documents; the 200 comes from its output. */
const spendResponses = canonicalBaseResponses;

/** Validated in the transform, not an array schema, so a refusal names group_by, not group_by.0. */
const groupBySchema = z
  .string()
  .transform((raw, ctx): SpendGroupByKey[] => {
    const keys = raw.split(",").map((part) => part.trim());
    const refuse = (message: string): typeof z.NEVER => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    };
    const unknown = keys.filter((key) => !SPEND_GROUP_BY_KEYS.includes(key as SpendGroupByKey));
    if (unknown.length > 0) {
      return refuse(`group_by must name one or two of ${SPEND_GROUP_BY_KEYS.join(", ")}`);
    }
    if (keys.length > MAX_GROUP_BY_KEYS) {
      return refuse(`group_by takes at most ${MAX_GROUP_BY_KEYS} dimensions`);
    }
    if (new Set(keys).size !== keys.length) {
      return refuse("group_by cannot repeat a dimension");
    }
    return keys as SpendGroupByKey[];
  })
  .meta({
    description: `One or two dimensions, comma separated: ${SPEND_GROUP_BY_KEYS.join(", ")}. A dimension may not repeat. Each row's \`key\` is the first dimension's value and \`group\` names them all, so two rows may share a key.`,
    example: "model,end_user",
  });

/** What a query string may say for yes and for no. Compared case-folded. */
const QUERY_BOOLEAN_TRUE = ["true", "1", "yes"];
const QUERY_BOOLEAN_FALSE = ["false", "0", "no", ""];

/**
 * z.coerce.boolean() is JS Boolean(): every non-empty string is true, so allow_unstable=false
 * would turn the guard OFF. Case is folded since the caller's HTTP library picks it, not them.
 */
const queryBoolean = z
  .string()
  .optional()
  .default("false")
  .transform((raw, ctx): boolean | typeof z.NEVER => {
    const spelling = raw.toLowerCase();
    if (QUERY_BOOLEAN_TRUE.includes(spelling)) return true;
    if (QUERY_BOOLEAN_FALSE.includes(spelling)) return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `must be one of ${[...QUERY_BOOLEAN_TRUE, ...QUERY_BOOLEAN_FALSE.filter(Boolean)].join(", ")}`,
    });
    return z.NEVER;
  })
  .meta({
    description: [
      `${QUERY_BOOLEAN_TRUE.join(", ")} for yes;`,
      `${QUERY_BOOLEAN_FALSE.filter(Boolean).join(", ")} or omitted for no.`,
      "Case does not matter, so a Python True is accepted as sent.",
    ].join(" "),
    example: "true",
  });

const spendSummariesQuerySchema = z
  .object({
    group_by: groupBySchema,
    bucket: z.enum(SPEND_BUCKETS).optional().default("none"),
    // An IANA zone, because a day boundary is the caller's local midnight and
    // re-bucketing UTC days afterwards cannot recover the requests that fell
    // on the other side of it. Checked here so an unknown zone is a 400 that
    // names the parameter rather than a ClickHouse error the caller cannot act
    // on.
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine((zone) => spendGrouping.isIanaTimeZone(zone), {
        message: "timezone must be an IANA zone name, e.g. Europe/Amsterdam",
      })
      .optional()
      .default("UTC"),
    allow_unstable: queryBoolean,
    from: epochMs,
    to: epochMs,
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().positive().max(1000).optional().default(500),
    ...spendFilterQueryShape,
    // The one filter this read narrows further than /spend-events does. A
    // rollup excludes in-flight rows from every sum, so accepting `admitted`
    // would answer a real question with a confident zero. The refusal names
    // the parameter, so a caller can act on it, and the events read still
    // serves those envelopes.
    status: spendSummaryStatusFilter
      .optional()
      .meta({ description: SPEND_SUMMARY_STATUS_DESCRIPTION }),
  })
  // An inverted window is an empty window, so a caller who swapped the two
  // reads a confident zero and reconciles against it. /spend-events has
  // refused this since it shipped; this surface answered instead.
  .refine((q) => q.from <= q.to, {
    message: "from must be less than or equal to to",
  });

const REPLAY_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REPLAY_MAX_ENVELOPES = 10_000;
const REPLAY_PAGE_SIZE = 200;

/** Refuses as soon as the cap is passed, BEFORE any envelope is queued: no partial ships. */
async function assertReplayWindowWithinCap({
  events,
  endpoint,
  accepts,
  organizationId,
  fromMs,
  toMs,
}: {
  events: GatewaySpendWebhookEvents;
  endpoint: GatewaySpendWebhookEndpoint;
  accepts: GatewaySpendApp["endpointAcceptsEvent"];
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
      if (!accepts({ enabledEvents: endpoint.enabledEvents, eventType: envelope.type })) {
        continue;
      }
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
  delivery,
  accepts,
  organizationId,
  fromMs,
  toMs,
  replayId,
}: {
  events: GatewaySpendWebhookEvents;
  endpoint: GatewaySpendWebhookEndpoint;
  delivery: GatewaySpendWebhookDelivery;
  accepts: GatewaySpendApp["endpointAcceptsEvent"];
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
      accepts({ enabledEvents: endpoint.enabledEvents, eventType: envelope.type }),
    );
    // The preflight cleared this window, but folds landing between the two
    // passes can still grow it. Ship up to the cap and stop there rather
    // than error out: the response reports what actually went out.
    const shippable = matching.slice(0, REPLAY_MAX_ENVELOPES - replayed);
    for (const envelope of shippable) {
      await delivery.appendReplayToEndpointStream({
        organizationId,
        endpoint,
        envelope,
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

export const gatewaySpendRest = defineRestRouter(GatewaySpendApi)
  .withNamespace("gateway-spend")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organization")
  // The generation is the contract, not a dated namespace, and the prefix is
  // shared with the virtual-key surface rather than owned: the routes answer
  // exactly where they answer today, with no `/api/v1` twin beside them.
  .withAddressing("literal", { v1Twin: false })

  .get("/api/gateway/v1/spend-summaries", "listGatewaySpendSummaries")
  .withQuery(spendSummariesQuerySchema)
  .withPermission("gatewaySpend:view")
  .withOutput(
    z.object({
      data: z.array(spendSummaryRowSchema),
      next_cursor: nextCursorSchema,
    }),
  )
  .withMiddleware(gatewaySpendBillingPlanGate)
  .withDocs({
    tags: ["Gateway Spend"],
    summary: "List spend summaries",
    description: SPEND_SUMMARIES_DESCRIPTION,
    responses: spendResponses,
  })
  .handle(async ({ app, input, scope }) => {
    // Same contract as /spend-events: a garbled cursor is refused rather
    // than silently restarting from the first key. A cursor decoding but
    // naming a different dimension count is refused too — a different walk
    // shape, and continuing would re-serve page one under a fresh cursor
    // with nothing saying the walk reset.
    if (input.cursor !== undefined) {
      const parts = spendCursors.decodeSpendSummariesCursor(input.cursor);
      const dimensionCount = input.group_by.length + (input.bucket === "none" ? 0 : 1);
      if (parts === null) {
        throw new BadRequestError("Invalid cursor.");
      }
      if (parts.length !== dimensionCount) {
        throw new BadRequestError(
          "This cursor belongs to a walk over a different grouping. Start a new walk without a cursor.",
        );
      }
    }
    spendGrouping.assertGroupingIsWalkable({
      keys: input.group_by,
      bucket: input.bucket,
      toMs: input.to,
      nowMs: nowInstant().epochMilliseconds,
      allowUnstable: input.allow_unstable,
      settlementPolicy: app.settlementPolicy,
    });
    const resolved = await app.resolveSpendScope({
      organizationId: scope.id,
      projectIds: input.project_id,
      teamIds: input.team_id,
      externalIds: input.external_id,
    });
    const page = await requireSpendEvents(app).getSpendSummaries({
      tenantIds: resolved.tenantIds,
      groupBy: input.group_by,
      bucket: input.bucket,
      timezone: input.timezone,
      fromMs: input.from,
      toMs: input.to,
      cursor: input.cursor ?? null,
      limit: input.limit,
      filters: spendFilters.spendFiltersFromQuery({
        query: input,
        overrides: { virtualKeyIds: resolved.virtualKeyIds },
      }),
    });

    return {
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
    };
  })

  .get("/api/gateway/v1/spend-events", "listGatewaySpendEvents")
  .withQuery(spendEventsQuerySchema)
  .withPermission("gatewaySpend:view")
  .withOutput(
    z.object({
      data: z.array(spendEventEnvelopeSchema),
      next_cursor: nextCursorSchema,
    }),
  )
  .withMiddleware(gatewaySpendBillingPlanGate)
  .withDocs({
    tags: ["Gateway Spend"],
    summary: "List spend events",
    description: SPEND_EVENTS_PULL_DESCRIPTION,
    responses: spendResponses,
  })
  .handle(async ({ app, input, scope }) => {
    // A present-but-garbled cursor is a caller bug: refusing beats
    // silently restarting the walk, which would re-serve the whole range.
    if (input.cursor !== undefined && !spendCursors.decodeSpendEventsCursor(input.cursor)) {
      throw new BadRequestError("Invalid cursor.");
    }
    const resolved = await app.resolveSpendScope({
      organizationId: scope.id,
      projectIds: input.project_id,
      teamIds: input.team_id,
      externalIds: input.external_id,
    });
    const page = await requireSpendEvents(app).walkSpendEvents({
      tenantIds: resolved.tenantIds,
      fromMs: input.from,
      toMs: input.to,
      cursor: input.cursor ?? null,
      limit: input.limit,
      filters: spendFilters.spendFiltersFromQuery({
        query: input,
        overrides: { virtualKeyIds: resolved.virtualKeyIds },
      }),
    });

    return {
      data: page.rows.map((row) => app.spendEventEnvelope(row)),
      next_cursor: page.nextCursor,
    };
  })

  .get("/api/gateway/v1/end-users/:id/spend", "getGatewayEndUserSpend")
  .withParams(endUserSpendParamsSchema)
  .withQuery(endUserSpendQuerySchema)
  .withPermission("gatewaySpend:view")
  .withOutput(z.object({ data: endUserSpendSchema }))
  .withMiddleware(gatewaySpendBillingPlanGate)
  .withDocs({
    tags: ["Gateway Spend"],
    summary: "Read one end user's spend",
    description: END_USER_SPEND_DESCRIPTION,
    responses: spendResponses,
  })
  .handle(async ({ app, input, scope }) => {
    const endUserId = input.id;
    const now = nowInstant().epochMilliseconds;
    const fromMs = input.from ?? now - END_USER_WINDOWS[input.window];
    const toMs = input.to ?? now;
    const { tenantIds } = await app.resolveSpendScope({ organizationId: scope.id });
    const rollup = await requireSpendEvents(app).getEndUserSpend({
      tenantIds,
      endUserId,
      fromMs,
      toMs,
      virtualKeyId: input.virtual_key_id,
    });
    const budgetRepository = app.budgetSpend;
    if (!budgetRepository) {
      // The ledger is the only store spend accrues in, so without ClickHouse
      // there are no figures to report against these caps.
      throw app.spendStoreUnavailable();
    }
    const caps = await app.endUserCaps({
      budgetRepository,
      organizationId: scope.id,
      endUserId,
      tenantIds,
      virtualKeyId: input.virtual_key_id,
    });

    return {
      data: {
        end_user_id: endUserId,
        window: input.window,
        from: Temporal.Instant.fromEpochMilliseconds(fromMs).toString({
          smallestUnit: "millisecond",
        }),
        to: Temporal.Instant.fromEpochMilliseconds(toMs).toString({
          smallestUnit: "millisecond",
        }),
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
    };
  })

  .post("/api/gateway/v1/spend-events/replay", "replayGatewaySpendEvents")
  .withInput(replayBodySchema)
  .withPermission("gatewaySpend:manage")
  .withOutput(z.object({ data: replayResultSchema }))
  .withMiddleware(gatewaySpendBillingPlanGate)
  .withDocs({
    tags: ["Gateway Spend"],
    summary: "Replay spend events to an endpoint",
    description: REPLAY_DESCRIPTION,
    responses: spendResponses,
  })
  .handle(async ({ app, input, scope }) => {
    const endpoint = await app.webhookEndpoints.tryGetDeliverable({
      organizationId: scope.id,
      endpointId: input.endpoint_id,
    });
    if (!endpoint) {
      throw new BadRequestError("unknown or inactive endpoint for this organization");
    }

    const events = app.webhookEvents;
    if (!events) throw app.spendStoreUnavailable();
    const delivery = app.webhookDelivery;
    if (!delivery) throw app.spendStoreUnavailable();

    // One replay identity per call: it salts batch ids and inbox source
    // ids so redelivered envelopes cannot collide with their historical
    // batches; the ENVELOPE ids stay untouched.
    await assertReplayWindowWithinCap({
      events,
      endpoint,
      accepts: app.endpointAcceptsEvent,
      organizationId: scope.id,
      fromMs: input.from,
      toMs: input.to,
    });

    const replayId = nanoid(10);
    const replayed = await appendWindowToEndpointStream({
      events,
      endpoint,
      delivery,
      accepts: app.endpointAcceptsEvent,
      organizationId: scope.id,
      fromMs: input.from,
      toMs: input.to,
      replayId,
    });

    return {
      data: {
        endpoint_id: endpoint.id,
        replay_id: replayId,
        replayed,
        window: {
          from: Temporal.Instant.fromEpochMilliseconds(input.from).toString({
            smallestUnit: "millisecond",
          }),
          to: Temporal.Instant.fromEpochMilliseconds(input.to).toString({
            smallestUnit: "millisecond",
          }),
        },
      },
    };
  })

  .build();
