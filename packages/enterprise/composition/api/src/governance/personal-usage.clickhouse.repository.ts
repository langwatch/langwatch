// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * PersonalUsageClickHouseRepository — the queries behind the /me usage
 * dashboard (PersonalUsageService).
 *
 * Two data sources, one repository:
 *   - `trace_summaries`, scoped to the user's personal-project TenantId
 *     (every personal project has exactly one user, so the TenantId scope
 *     IS the user scope — no userId column needed).
 *   - `gateway_budget_ledger_events`, scoped to the org's hidden
 *     Governance Project TenantId AND Scope='principal' AND
 *     ScopeId=userId — ingestion-source traffic (Claude Code OTLP, etc.)
 *     that lands under the governance tenant rather than the personal
 *     project. See {@link PRINCIPAL_REQUESTS_SUBQUERY} for why every read
 *     against it collapses to one row per gateway request first.
 *
 * Every query filters on the partition key (`OccurredAt`) so ClickHouse
 * prunes partitions per dev/docs/best_practices/clickhouse-queries.md, and
 * the trace_summaries reads apply the IN-tuple / argMax dedup pattern.
 */
import { nanoUsdToDecimalString, parseSummedNanoUsd } from "./governance-money";

type PersonalUsageClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, string | number>;
    format: "JSONEachRow";
  }): Promise<{ json(): Promise<unknown> }>;
};

type PersonalUsageClickHouseClientResolver = (
  tenantId: string,
) => Promise<PersonalUsageClickHouseClient>;

const PERSONAL_USAGE_CLICKHOUSE_SETTINGS: Record<string, number> = {
  max_bytes_before_external_group_by: 500_000_000,
};

export interface PersonalUsageWindow {
  /** Inclusive UTC start of the rollup window. */
  start: Date;
  /** Exclusive UTC end of the rollup window. */
  end: Date;
}

export interface PersonalUsageSummaryRow {
  totalCost: number;
  billedCost: number;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
}

export interface PersonalUsageTopModelRow {
  model: string;
  requests: number;
}

export interface PersonalUsageDailyRow {
  day: string;
  spentUsd: number;
  billedUsd: number;
  requests: number;
}

export interface PersonalUsageModelBreakdownRow {
  label: string;
  spentUsd: number;
  billedUsd: number;
  requests: number;
}

export interface IngestionPrincipalSummaryRow {
  totalCost: number;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  topModel: { name: string; requests: number } | null;
}

/**
 * The user's principal-scope ledger rows, collapsed to one row per gateway
 * request.
 *
 * Two things make this exact rather than approximate. Every row a single
 * request writes carries that request's own cost, tokens and model, so
 * `any()` over the group returns the request's values whichever row it
 * picks. And the group key is the request id, so N budgets contributing N
 * identical rows collapse to the one row the request actually is. It also
 * absorbs an un-merged ReplacingMergeTree replay, which a bare `sum` over
 * the raw table would have counted twice.
 *
 * Money rides `AmountNanoUSD`, the ledger's integer money column, and is
 * summed there. `AmountUSD` is a `Decimal(18, 6)` that cannot hold a nano
 * figure: it renders a single debit for an audit read and is never summed,
 * because rounding each debit to a micro-USD and then adding them is not the
 * amount anybody spent and the gap grows with request count rather than
 * cancelling. See `budget.clickhouse.repository.ts`, which is the rule this
 * follows, and migration 00070.
 *
 * `Status = 'success'` matches every other read of this ledger, including the
 * materialized view behind the budget rollup. A provider error or a
 * guardrail block writes a row too, and neither is spend the user made.
 *
 * The aliases are deliberately not the column names they aggregate:
 * ClickHouse resolves an alias back into the same SELECT's WHERE, so
 * `any(OccurredAt) AS OccurredAt` puts an aggregate in the WHERE clause and
 * the whole read fails.
 */
const PRINCIPAL_REQUESTS_SUBQUERY = `
  SELECT
    GatewayRequestId,
    any(AmountNanoUSD) AS RequestAmountNanoUSD,
    any(TokensInput)   AS RequestTokensInput,
    any(TokensOutput)  AS RequestTokensOutput,
    any(Model)         AS RequestModel,
    any(OccurredAt)    AS RequestOccurredAt
  FROM gateway_budget_ledger_events
  WHERE TenantId = {tenantId:String}
    AND Scope = 'principal'
    AND ScopeId = {userId:String}
    AND Status = 'success'
    AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
    AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
  GROUP BY GatewayRequestId
`;

/**
 * A summed Int64 nano-USD figure as the USD number this surface publishes.
 *
 * `toString` on the ClickHouse side and `BigInt` on this one, because a sum
 * past 2^53 loses its low digits as a JSON number and a wrong money figure is
 * worse than a loud one. The decimal string is then read out digit by digit
 * rather than divided, so the USD number is the nearest double to the exact
 * amount instead of the exact amount plus float division's own drift.
 */
function summedNanoUsdToUsd(value: unknown): number {
  return Number(nanoUsdToDecimalString(parseSummedNanoUsd(value)));
}

function formatSettings(settings: Record<string, number | string>): string {
  return Object.entries(settings)
    .map(([k, v]) => `${k} = ${v}`)
    .join(", ");
}

export class AppPersonalUsageReadAdapter {
  constructor(private readonly resolveClient: PersonalUsageClickHouseClientResolver) {}

  breakdownByModel(
    input: { personalProjectId: string },
    limit = 8,
  ): Promise<PersonalUsageModelBreakdownRow[]> {
    const now = new Date();

    return this.findModelBreakdown({
      tenantId: input.personalProjectId,
      window: {
        start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        end: new Date(now.getTime() + 1),
      },
      limit,
    });
  }

  /**
   * Aggregated spend + token summary from `trace_summaries` for the
   * window. Returns zeros when the tenant has no traces in range.
   */
  async findSummary(input: {
    tenantId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageSummaryRow> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          sum(SpentUsd)        AS TotalCost,
          sum(coalesce(SpentUsd, 0) - NonBilledUsd) AS BilledCost,
          countDistinct(TraceId) AS RequestCount,
          sum(PromptTokens)    AS PromptTokens,
          sum(CompletionTokens) AS CompletionTokens
        FROM (
          SELECT
            TraceId,
            argMax(TotalCost, UpdatedAt)               AS SpentUsd,
            argMax(coalesce(NonBilledCost, if(Attributes['langwatch.cost.non_billable'] = 'true', TotalCost, 0), 0), UpdatedAt) AS NonBilledUsd,
            argMax(TotalPromptTokenCount, UpdatedAt)   AS PromptTokens,
            argMax(TotalCompletionTokenCount, UpdatedAt) AS CompletionTokens
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= {fromMs:DateTime64(3, 'UTC')}
            AND OccurredAt <  {toMs:DateTime64(3, 'UTC')}
          GROUP BY TraceId
        )
        SETTINGS ${formatSettings(PERSONAL_USAGE_CLICKHOUSE_SETTINGS)}
      `,
      query_params: {
        tenantId: input.tenantId,
        fromMs: input.window.start.getTime(),
        toMs: input.window.end.getTime(),
      },
      format: "JSONEachRow",
    });

    type RawSummary = {
      TotalCost: number | null;
      BilledCost: number | null;
      RequestCount: number | null;
      PromptTokens: number | null;
      CompletionTokens: number | null;
    };
    const [row] = (await result.json()) as RawSummary[];
    if (!row) {
      return {
        totalCost: 0,
        billedCost: 0,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
      };
    }
    return {
      totalCost: Number(row.TotalCost) || 0,
      billedCost: Number(row.BilledCost) || 0,
      requestCount: Number(row.RequestCount) || 0,
      promptTokens: Number(row.PromptTokens) || 0,
      completionTokens: Number(row.CompletionTokens) || 0,
    };
  }

  /** The single most-used model by request count in the window, or null. */
  async findTopModel(input: {
    tenantId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageTopModelRow | null> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          Model,
          count() AS Requests
        FROM (
          SELECT
            TraceId,
            arrayJoin(argMax(Models, UpdatedAt)) AS Model
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= {fromMs:DateTime64(3, 'UTC')}
            AND OccurredAt <  {toMs:DateTime64(3, 'UTC')}
            AND notEmpty(Models)
          GROUP BY TraceId
        )
        GROUP BY Model
        ORDER BY Requests DESC
        LIMIT 1
        SETTINGS ${formatSettings(PERSONAL_USAGE_CLICKHOUSE_SETTINGS)}
      `,
      query_params: {
        tenantId: input.tenantId,
        fromMs: input.window.start.getTime(),
        toMs: input.window.end.getTime(),
      },
      format: "JSONEachRow",
    });

    type RawTopModel = { Model: string; Requests: number };
    const rows = (await result.json()) as RawTopModel[];
    const top = rows[0];
    if (!top) return null;
    return { model: top.Model, requests: Number(top.Requests) || 0 };
  }

  /** Daily spend buckets from `trace_summaries`, one row per day present. */
  async findDailyBuckets(input: {
    tenantId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageDailyRow[]> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          toDate(LatestOccurredAt) AS Day,
          sum(TraceSpentUsd)       AS SpentUsd,
          sum(coalesce(TraceSpentUsd, 0) - NonBilledUsd) AS BilledUsd,
          count()                  AS Requests
        FROM (
          SELECT
            TraceId,
            argMax(OccurredAt, UpdatedAt) AS LatestOccurredAt,
            argMax(TotalCost, UpdatedAt)  AS TraceSpentUsd,
            argMax(coalesce(NonBilledCost, if(Attributes['langwatch.cost.non_billable'] = 'true', TotalCost, 0), 0), UpdatedAt) AS NonBilledUsd
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= {fromMs:DateTime64(3, 'UTC')}
            AND OccurredAt <  {toMs:DateTime64(3, 'UTC')}
          GROUP BY TraceId
        )
        GROUP BY Day
        ORDER BY Day
        SETTINGS ${formatSettings(PERSONAL_USAGE_CLICKHOUSE_SETTINGS)}
      `,
      query_params: {
        tenantId: input.tenantId,
        fromMs: input.window.start.getTime(),
        toMs: input.window.end.getTime(),
      },
      format: "JSONEachRow",
    });

    type RawBucket = {
      Day: string;
      SpentUsd: number;
      BilledUsd: number;
      Requests: number;
    };
    const rows = (await result.json()) as RawBucket[];
    return rows.map((r) => ({
      day: r.Day,
      spentUsd: Number(r.SpentUsd) || 0,
      billedUsd: Number(r.BilledUsd) || 0,
      requests: Number(r.Requests) || 0,
    }));
  }

  /**
   * Per-model spend breakdown from `trace_summaries`. Attribution-by-
   * presence: a multi-model trace contributes its full TotalCost to each
   * model that appears in its Models array — see PersonalUsageService for
   * why that's the right trade-off for "which tools did the user
   * actually invoke".
   */
  async findModelBreakdown(input: {
    tenantId: string;
    window: PersonalUsageWindow;
    limit: number;
  }): Promise<PersonalUsageModelBreakdownRow[]> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          Model,
          sum(TraceSpentUsd) AS SpentUsd,
          sum(coalesce(TraceSpentUsd, 0) - NonBilledUsd) AS BilledUsd,
          count()       AS Requests
        FROM (
          SELECT
            TraceId,
            arrayJoin(argMax(Models, UpdatedAt)) AS Model,
            argMax(TotalCost, UpdatedAt)         AS TraceSpentUsd,
            argMax(coalesce(NonBilledCost, if(Attributes['langwatch.cost.non_billable'] = 'true', TotalCost, 0), 0), UpdatedAt) AS NonBilledUsd
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= {fromMs:DateTime64(3, 'UTC')}
            AND OccurredAt <  {toMs:DateTime64(3, 'UTC')}
            AND notEmpty(Models)
          GROUP BY TraceId
        )
        GROUP BY Model
        ORDER BY SpentUsd DESC
        LIMIT {lim:UInt32}
        SETTINGS ${formatSettings(PERSONAL_USAGE_CLICKHOUSE_SETTINGS)}
      `,
      query_params: {
        tenantId: input.tenantId,
        fromMs: input.window.start.getTime(),
        toMs: input.window.end.getTime(),
        lim: input.limit,
      },
      format: "JSONEachRow",
    });

    type RawBreakdown = {
      Model: string;
      SpentUsd: number;
      BilledUsd: number;
      Requests: number;
    };
    const rows = (await result.json()) as RawBreakdown[];
    return rows.map((r) => ({
      label: r.Model,
      spentUsd: Number(r.SpentUsd) || 0,
      billedUsd: Number(r.BilledUsd) || 0,
      requests: Number(r.Requests) || 0,
    }));
  }

  /**
   * Per-user spend rollup from `gateway_budget_ledger_events`, PRINCIPAL
   * scope only. Null when the collapsed request subquery has no rows for
   * this user in the window — see the class doc for what this misses
   * (events that only hit ORG/PROJECT-scope budgets).
   */
  async findIngestionPrincipalSummary(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<IngestionPrincipalSummaryRow | null> {
    const client = await this.resolveClient(input.tenantId);
    const queryParams = {
      tenantId: input.tenantId,
      userId: input.userId,
      fromMs: input.window.start.getTime(),
      toMs: input.window.end.getTime(),
    };

    const result = await client.query({
      query: `
        SELECT
          toString(sum(RequestAmountNanoUSD)) AS TotalNanoCost,
          count()                             AS RequestCount,
          sum(RequestTokensInput)             AS PromptTokens,
          sum(RequestTokensOutput)            AS CompletionTokens
        FROM (${PRINCIPAL_REQUESTS_SUBQUERY})
        SETTINGS ${formatSettings(PERSONAL_USAGE_CLICKHOUSE_SETTINGS)}
      `,
      query_params: queryParams,
      format: "JSONEachRow",
    });

    type RawSummary = {
      TotalNanoCost: string | null;
      RequestCount: number | null;
      PromptTokens: number | null;
      CompletionTokens: number | null;
    };
    const [row] = (await result.json()) as RawSummary[];
    if (!row || !Number(row.RequestCount)) return null;

    const topModelResult = await client.query({
      query: `
        SELECT
          RequestModel AS Name,
          count()       AS Requests
        FROM (${PRINCIPAL_REQUESTS_SUBQUERY})
        GROUP BY RequestModel
        ORDER BY Requests DESC
        LIMIT 1
        SETTINGS ${formatSettings(PERSONAL_USAGE_CLICKHOUSE_SETTINGS)}
      `,
      query_params: queryParams,
      format: "JSONEachRow",
    });
    type RawTop = { Name: string; Requests: number | null };
    const [topRow] = (await topModelResult.json()) as RawTop[];

    return {
      totalCost: summedNanoUsdToUsd(row.TotalNanoCost),
      requestCount: Number(row.RequestCount) || 0,
      promptTokens: Number(row.PromptTokens) || 0,
      completionTokens: Number(row.CompletionTokens) || 0,
      topModel: topRow ? { name: topRow.Name, requests: Number(topRow.Requests) || 0 } : null,
    };
  }

  /** Daily PRINCIPAL-scope spend buckets from `gateway_budget_ledger_events`. */
  async findIngestionPrincipalBuckets(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageDailyRow[]> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          toDate(RequestOccurredAt)           AS Day,
          toString(sum(RequestAmountNanoUSD)) AS SpentNanoUsd,
          count()                             AS Requests
        FROM (${PRINCIPAL_REQUESTS_SUBQUERY})
        GROUP BY Day
        ORDER BY Day
        SETTINGS ${formatSettings(PERSONAL_USAGE_CLICKHOUSE_SETTINGS)}
      `,
      query_params: {
        tenantId: input.tenantId,
        userId: input.userId,
        fromMs: input.window.start.getTime(),
        toMs: input.window.end.getTime(),
      },
      format: "JSONEachRow",
    });
    type Raw = { Day: string; SpentNanoUsd: string; Requests: number };
    const rows = (await result.json()) as Raw[];
    return rows.map((r) => {
      const spentUsd = summedNanoUsdToUsd(r.SpentNanoUsd);
      // The gateway ledger records real per-token spend (virtual-key
      // traffic the customer pays for), so it is fully billed.
      return {
        day: r.Day,
        spentUsd,
        billedUsd: spentUsd,
        requests: Number(r.Requests) || 0,
      };
    });
  }

  /** Per-model PRINCIPAL-scope spend breakdown from `gateway_budget_ledger_events`. */
  async findIngestionPrincipalBreakdown(input: {
    tenantId: string;
    userId: string;
    window: PersonalUsageWindow;
  }): Promise<PersonalUsageModelBreakdownRow[]> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          RequestModel                        AS Label,
          toString(sum(RequestAmountNanoUSD)) AS SpentNanoUsd,
          count()                             AS Requests
        FROM (${PRINCIPAL_REQUESTS_SUBQUERY})
        GROUP BY Label
        ORDER BY sum(RequestAmountNanoUSD) DESC
        SETTINGS ${formatSettings(PERSONAL_USAGE_CLICKHOUSE_SETTINGS)}
      `,
      query_params: {
        tenantId: input.tenantId,
        userId: input.userId,
        fromMs: input.window.start.getTime(),
        toMs: input.window.end.getTime(),
      },
      format: "JSONEachRow",
    });
    type Raw = { Label: string; SpentNanoUsd: string; Requests: number };
    const rows = (await result.json()) as Raw[];
    return rows.map((r) => {
      const spentUsd = summedNanoUsdToUsd(r.SpentNanoUsd);
      // Gateway ledger spend is real per-token spend, so fully billed.
      return {
        label: r.Label,
        spentUsd,
        billedUsd: spentUsd,
        requests: Number(r.Requests) || 0,
      };
    });
  }
}
