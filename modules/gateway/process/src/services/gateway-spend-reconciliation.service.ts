/**
 * The spend reconciliation reads behind `/api/gateway/v1`: each route's parsed query in, its
 * page out. Refusals are the ones the routes always gave. The replay is webhook's.
 */
import { BadRequestError } from "@langwatch/api/rest";
import {
  GATEWAY_END_USER_SPEND_WINDOWS,
  type GatewayEndUserSpendQuery,
  type GatewayEndUserSpendResponse,
  type GatewaySpendEventEnvelope,
  type GatewaySpendEventsPage,
  type GatewaySpendEventsQuery,
  type GatewaySpendSummariesPage,
  type GatewaySpendSummariesQuery,
} from "@langwatch/gateway-contract";
import { nowInstant, Temporal } from "@langwatch/time";

import type { GatewayBudgetSpend, GatewaySettlementPolicy } from "../app/gateway.members.ts";
import {
  decodeSpendEventsCursor,
  decodeSpendSummariesCursor,
} from "../rules/gateway-spend-cursor.rules.ts";
import { spendFiltersFromQuery } from "../rules/gateway-spend-filters.rules.ts";
import { assertGroupingIsWalkable } from "../rules/gateway-spend-grouping.rules.ts";
import type { GatewayEndUserCap } from "./gateway-end-user-caps.service.ts";
import type { GatewaySpendEventsService } from "./gateway-spend-events.service.ts";

/** One row of the spend ledger, as the events reader hands it over. */
type SpendLedgerRow = Awaited<
  ReturnType<GatewaySpendEventsService["walkSpendEvents"]>
>["rows"][number];

/** Postgres filters a spend read narrows by, before they resolve to ClickHouse ids. */
export type GatewaySpendScopeQuery = {
  organizationId: string;
  projectIds?: string[];
  teamIds?: string[];
  externalIds?: string[];
};

/** The tenants and keys a spend read covers; a no-match is empty, never "unfiltered". */
export type GatewaySpendScope = { tenantIds: string[]; virtualKeyIds?: string[] };

/**
 * The whole of what the three reconciliation reads ask the application for.
 */
export type GatewaySpendApp = Readonly<{
  /**
   * The ledger reads. Refused on a deployment without ClickHouse, where there
   * are no figures to report at all, rather than answering with a confident zero.
   */
  getSpendEvents(): GatewaySpendEventsService;
  /** The budget ledger the per-end-user caps are read against. */
  getBudgetSpend(): GatewayBudgetSpend;

  /**
   * One spend row rendered as the canonical billing envelope. The wire format
   * is the webhook platform's, and the pull and the push must answer the same
   * bytes, so the mapping arrives rather than being restated here.
   */
  spendEventEnvelope(row: SpendLedgerRow): GatewaySpendEventEnvelope;

  /**
   * How long after a request an outcome may still arrive, which is what makes
   * a recent grouping unstable under a page walk.
   */
  settlementPolicy(): GatewaySettlementPolicy;

  /** Resolves Postgres filters to CH ids. A no-match resolves to EMPTY, never "unfiltered". */
  resolveSpendScope(input: GatewaySpendScopeQuery): Promise<GatewaySpendScope>;

  /** Every attributed-user budget that applies to one end user, with spend. */
  endUserCaps(input: {
    organizationId: string;
    endUserId: string;
    tenantIds: string[];
    virtualKeyId?: string;
    budgetRepository: GatewayBudgetSpend;
  }): Promise<GatewayEndUserCap[]>;
}>;

/** The three reconciliation reads' logic over what the application lends them. */
export class GatewaySpendReconciliationService {
  static create({
    collaborators,
  }: {
    collaborators: GatewaySpendApp;
  }): GatewaySpendReconciliationService {
    return new GatewaySpendReconciliationService(collaborators);
  }

  private constructor(private readonly collaborators: GatewaySpendApp) {}

  /** Spend rollups: refuses a foreign cursor or an unstable grouping before any read. */
  async answerSpendSummaries({
    organizationId,
    query,
  }: {
    organizationId: string;
    query: GatewaySpendSummariesQuery;
  }): Promise<GatewaySpendSummariesPage> {
    // Same contract as /spend-events: a garbled cursor is refused rather
    // than silently restarting from the first key. A cursor decoding but
    // naming a different dimension count is refused too — a different walk
    // shape, and continuing would re-serve page one under a fresh cursor
    // with nothing saying the walk reset.
    if (query.cursor !== undefined) {
      const parts = decodeSpendSummariesCursor(query.cursor);
      const dimensionCount = query.group_by.length + (query.bucket === "none" ? 0 : 1);
      if (parts === null) {
        throw new BadRequestError("Invalid cursor.");
      }
      if (parts.length !== dimensionCount) {
        throw new BadRequestError(
          "This cursor belongs to a walk over a different grouping. Start a new walk without a cursor.",
        );
      }
    }
    assertGroupingIsWalkable({
      keys: query.group_by,
      bucket: query.bucket,
      toMs: query.to,
      nowMs: nowInstant().epochMilliseconds,
      allowUnstable: query.allow_unstable,
      settlementPolicy: this.collaborators.settlementPolicy(),
    });
    const resolved = await this.collaborators.resolveSpendScope({
      organizationId: organizationId,
      projectIds: query.project_id,
      teamIds: query.team_id,
      externalIds: query.external_id,
    });
    const page = await this.collaborators.getSpendEvents().getSpendSummaries({
      tenantIds: resolved.tenantIds,
      groupBy: query.group_by,
      bucket: query.bucket,
      timezone: query.timezone,
      fromMs: query.from,
      toMs: query.to,
      cursor: query.cursor ?? null,
      limit: query.limit,
      filters: spendFiltersFromQuery({
        query,
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
          input_image_tokens: r.tokensInputImage,
          output_image_tokens: r.tokensOutputImage,
          image_count: r.imageCount,
        },
        cost: { total_usd: r.costUsd, nano_usd: r.costNanoUsd },
      })),
      next_cursor: page.nextCursor,
    };
  }

  /** The per-request ledger, walked in insert order. */
  async answerSpendEvents({
    organizationId,
    query,
  }: {
    organizationId: string;
    query: GatewaySpendEventsQuery;
  }): Promise<GatewaySpendEventsPage> {
    // A present-but-garbled cursor is a caller bug: refusing beats
    // silently restarting the walk, which would re-serve the whole range.
    if (query.cursor !== undefined && !decodeSpendEventsCursor(query.cursor)) {
      throw new BadRequestError("Invalid cursor.");
    }
    const resolved = await this.collaborators.resolveSpendScope({
      organizationId: organizationId,
      projectIds: query.project_id,
      teamIds: query.team_id,
      externalIds: query.external_id,
    });
    const page = await this.collaborators.getSpendEvents().walkSpendEvents({
      tenantIds: resolved.tenantIds,
      fromMs: query.from,
      toMs: query.to,
      cursor: query.cursor ?? null,
      limit: query.limit,
      filters: spendFiltersFromQuery({
        query,
        overrides: { virtualKeyIds: resolved.virtualKeyIds },
      }),
    });

    return {
      data: page.rows.map((row) => this.collaborators.spendEventEnvelope(row)),
      next_cursor: page.nextCursor,
    };
  }

  /** One end user's windowed spend and the caps that apply to them. */
  async answerEndUserSpend({
    organizationId,
    query,
  }: {
    organizationId: string;
    query: GatewayEndUserSpendQuery;
  }): Promise<GatewayEndUserSpendResponse> {
    const endUserId = query.id;
    const now = nowInstant().epochMilliseconds;
    const fromMs = query.from ?? now - GATEWAY_END_USER_SPEND_WINDOWS[query.window];
    const toMs = query.to ?? now;
    const { tenantIds } = await this.collaborators.resolveSpendScope({
      organizationId: organizationId,
    });
    const rollup = await this.collaborators.getSpendEvents().getEndUserSpend({
      tenantIds,
      endUserId,
      fromMs,
      toMs,
      virtualKeyId: query.virtual_key_id,
    });
    const budgetRepository = this.collaborators.getBudgetSpend();
    const caps = await this.collaborators.endUserCaps({
      budgetRepository,
      organizationId: organizationId,
      endUserId,
      tenantIds,
      virtualKeyId: query.virtual_key_id,
    });

    return {
      data: {
        end_user_id: endUserId,
        window: query.window,
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
          input_image_tokens: rollup.tokensInputImage,
          output_image_tokens: rollup.tokensOutputImage,
          image_count: rollup.imageCount,
        },
        caps,
      },
    };
  }
}
