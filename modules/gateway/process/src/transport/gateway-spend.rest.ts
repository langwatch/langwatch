import {
  canonicalBaseResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  gatewayEndUserSpendParamsSchema,
  gatewayEndUserSpendQuerySchema,
  gatewayEndUserSpendResponseSchema,
  type GatewayEndUserSpendQuery,
  type GatewayEndUserSpendResponse,
  gatewaySpendEventsPageSchema,
  gatewaySpendEventsQuerySchema,
  type GatewaySpendEventsPage,
  type GatewaySpendEventsQuery,
  gatewaySpendReplayBodySchema,
  gatewaySpendReplayResponseSchema,
  type GatewaySpendReplayBody,
  type GatewaySpendReplayResponse,
  gatewaySpendSummariesPageSchema,
  gatewaySpendSummariesQuerySchema,
  type GatewaySpendSummariesPage,
  type GatewaySpendSummariesQuery,
} from "@langwatch/gateway-contract";
import { moduleApi } from "@langwatch/kernel/module-api";
import { z } from "zod";

/**
 * @see ADR-072 (pull gates under the same plan flag as push)
 * Billing reconciliation REST on `/api/gateway/v1`, shared with the
 * virtual-key surface — each route owns its whole path, no wildcard claimed.
 */

/** Pinned as constants: the 13-month window and dedup guidance are load-bearing for consumers. */
export const SPEND_EVENTS_PULL_DESCRIPTION =
  "Cursor-paged pull over the per-request spend record, ascending by insert order so rows folded late are never skipped by an in-flight cursor. Events are the same canonical objects webhook deliveries carry. Retention is a fixed 13 months, which bounds reconciliation and replay. When feeding a downstream biller, mind its dedup window (Metronome 34 days and Stripe meters 24h+ at the time of writing; both vendors own those numbers, so confirm the current one before you rely on it): re-pulling older ranges into a biller past its window can double-bill. Every filter here is accepted by /spend-summaries too, so a checksum that disagrees can be diffed on exactly the same narrowing; the one difference is `status=admitted`, which only this read answers, because an admitted request is still in flight and contributes no cost to a rollup. Repeat a filter to widen it (`model=a&model=b` matches either); name two different filters to narrow. `metadata` is written `key:value`, split on the first colon, and repeating a key widens that key. `team_id` and `external_id` name Postgres records and are resolved to the projects and keys they cover, so a team with no projects or an external id nobody minted answers with no spend rather than with everything.";

export const SPEND_SUMMARIES_DESCRIPTION =
  "Reconciliation checksum fast path: spend rollups with token classes and integer nano-USD cost. Settled (unpriced) requests are counted separately as settled_count and never included in cost sums. Diff individual items via /spend-events only when a checksum diverges. `group_by` takes one or two of virtual_key, end_user, project, model, provider, principal and request_type, comma-separated, and `bucket` adds an hour or day column in the `timezone` you name. `key` stays the first dimension's value for consumers written against the single-dimension surface; read `group` to tell two dimensions apart. Paged by group key ascending: follow next_cursor until it comes back null, because a page that is full does not mean the window held nothing more. Grouping by model or provider, or into time buckets, is refused with `gateway_spend_group_by_unstable` while the window is recent enough that outcomes can still arrive, because those groups can move under a page walk and the totals would double-count some requests and miss others; ask for an older range, or send `allow_unstable` when an approximate shape is enough. Every filter here is accepted by /spend-events too, and the reverse holds apart from `status=admitted`: a rollup sums the cost of requests past admission, so an admitted request has none to contribute and that narrowing is refused rather than answered with a zero. Ask /spend-events for those.";

export const END_USER_SPEND_DESCRIPTION =
  "Windowed spend rollup for one external end user across the organization (the /customer/info-style read a rebilling integration polls). `caps` lists every attributed-user budget that applies to this end user, each with its limit and the spend against it. It is an empty array until such a budget template applies, never null.";

/** What the four reconciliation routes reach: each route's parsed request in, its page out. */
export interface GatewaySpendDoorApi {
  answerSpendSummaries(
    input: Readonly<{ organizationId: string; query: GatewaySpendSummariesQuery }>,
  ): Promise<GatewaySpendSummariesPage>;
  answerSpendEvents(
    input: Readonly<{ organizationId: string; query: GatewaySpendEventsQuery }>,
  ): Promise<GatewaySpendEventsPage>;
  answerEndUserSpend(
    input: Readonly<{ organizationId: string; query: GatewayEndUserSpendQuery }>,
  ): Promise<GatewayEndUserSpendResponse>;
  answerSpendReplay(
    input: Readonly<{ organizationId: string; body: GatewaySpendReplayBody }>,
  ): Promise<GatewaySpendReplayResponse>;
}

export const GatewaySpendApi = moduleApi<GatewaySpendDoorApi>()("gateway");

/**
 * Whether the credential's organization holds the plan billing events is
 * sold under (ADR-072). Bound via `withTransportFacts` against the
 * `entitlement` peer, resolved after auth and the permission check.
 */
export const gatewaySpendBillingPlanGate = defineRestMiddleware(
  "gatewaySpendBillingPlanGate",
  z.object({}),
);

const spendResponses = canonicalBaseResponses;

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
  .withQuery(gatewaySpendSummariesQuerySchema)
  .withPermission("gatewaySpend:view")
  .withOutput(gatewaySpendSummariesPageSchema)
  .withMiddleware(gatewaySpendBillingPlanGate)
  .withDocs({
    tags: ["Gateway Spend"],
    summary: "List spend summaries",
    description: SPEND_SUMMARIES_DESCRIPTION,
    responses: spendResponses,
  })
  .handle(({ app, input, scope }) =>
    app.answerSpendSummaries({ organizationId: scope.id, query: input }),
  )

  .get("/api/gateway/v1/spend-events", "listGatewaySpendEvents")
  .withQuery(gatewaySpendEventsQuerySchema)
  .withPermission("gatewaySpend:view")
  .withOutput(gatewaySpendEventsPageSchema)
  .withMiddleware(gatewaySpendBillingPlanGate)
  .withDocs({
    tags: ["Gateway Spend"],
    summary: "List spend events",
    description: SPEND_EVENTS_PULL_DESCRIPTION,
    responses: spendResponses,
  })
  .handle(({ app, input, scope }) =>
    app.answerSpendEvents({ organizationId: scope.id, query: input }),
  )

  .get("/api/gateway/v1/end-users/:id/spend", "getGatewayEndUserSpend")
  .withParams(gatewayEndUserSpendParamsSchema)
  .withQuery(gatewayEndUserSpendQuerySchema)
  .withPermission("gatewaySpend:view")
  .withOutput(gatewayEndUserSpendResponseSchema)
  .withMiddleware(gatewaySpendBillingPlanGate)
  .withDocs({
    tags: ["Gateway Spend"],
    summary: "Read one end user's spend",
    description: END_USER_SPEND_DESCRIPTION,
    responses: spendResponses,
  })
  .handle(({ app, input, scope }) =>
    app.answerEndUserSpend({ organizationId: scope.id, query: input }),
  )

  .post("/api/gateway/v1/spend-events/replay", "replayGatewaySpendEvents")
  .withInput(gatewaySpendReplayBodySchema)
  .withPermission("gatewaySpend:manage")
  .withOutput(gatewaySpendReplayResponseSchema)
  .withMiddleware(gatewaySpendBillingPlanGate)
  .withDocs({
    tags: ["Gateway Spend"],
    summary: "Replay spend events to an endpoint",
    description: REPLAY_DESCRIPTION,
    responses: spendResponses,
  })
  .handle(({ app, input, scope }) =>
    app.answerSpendReplay({ organizationId: scope.id, body: input }),
  )

  .build();
