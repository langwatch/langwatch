/**
 * Org-wide counts for the self-hosted daily usage telemetry sender
 * (`usageStatsWorker.ts` → `collectUsageStats.ts` → `usage-report/collect.ts`).
 * Every read spans every project the reporting organization owns — the
 * "tenant" for this report is the organization, not a single project — so the
 * first predicate is `TenantId IN (...)` over that organization's project ids,
 * not a single `TenantId = {tenantId:String}`.
 *
 * Every count is taken lifetime and over a window, which is what `since`
 * carries: omitted means lifetime, set means "at or after this instant". A
 * windowed read filters on the table's partition column, so it prunes to the
 * partitions the window covers and never touches cold storage. A lifetime
 * read has no range to prune by; each one below says what it costs.
 *
 * Nothing here reads a body, a name, a prompt or an address: every query
 * returns a count, a sum of money, or a timestamp.
 */

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

export interface InstanceUsageCountsInput {
  organizationId: string;
  projectIds: string[];
  /** Count only what happened at or after this instant. Omitted is lifetime. */
  since?: Date;
}

/** What the gateway's spend ledger says about one stretch of time. */
export interface InstanceGatewaySpend {
  /** Requests, one row each in the ledger. */
  requests: number;
  /** What those requests cost, in USD. */
  spendUsd: number;
}

export interface InstanceUsageStatsRepository {
  findTraceCount(input: InstanceUsageCountsInput): Promise<number>;
  findScenarioRunCount(input: InstanceUsageCountsInput): Promise<number>;
  findSpanCount(input: InstanceUsageCountsInput): Promise<number>;
  findGatewaySpend(
    input: InstanceUsageCountsInput,
  ): Promise<InstanceGatewaySpend>;
  findInstantEvalRunCount(input: InstanceUsageCountsInput): Promise<number>;
  findInstantEvalJudgmentCount(
    input: InstanceUsageCountsInput,
  ): Promise<number>;
  findCodingAgentSessionCount(input: InstanceUsageCountsInput): Promise<number>;
  findFirstGatewayRequestAt(
    input: InstanceUsageCountsInput,
  ): Promise<Date | null>;
  findFirstInstantEvalRunAt(
    input: InstanceUsageCountsInput,
  ): Promise<Date | null>;
  findFirstCodingAgentSessionAt(
    input: InstanceUsageCountsInput,
  ): Promise<Date | null>;
}

const NANO_PER_USD = 1_000_000_000;

/**
 * The window predicate on a table's time column, or no predicate at all.
 *
 * Absent rather than `>= 1970`, because a lifetime read of a wide table is
 * then a read of the sort key alone, with no time column decoded beside it.
 */
function windowOn(column: string, since: Date | undefined): string {
  return since
    ? `AND ${column} >= fromUnixTimestamp64Milli({since:Int64})`
    : "";
}

/** The parameters every count takes, with the window bound when there is one. */
function params(
  projectIds: string[],
  since: Date | undefined,
): Record<string, unknown> {
  return since ? { projectIds, since: since.getTime() } : { projectIds };
}

export class InstanceUsageStatsClickHouseRepository
  implements InstanceUsageStatsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async findScenarioRunCount({
    organizationId,
    projectIds,
    since,
  }: InstanceUsageCountsInput): Promise<number> {
    if (projectIds.length === 0) return 0;

    const client = await this.resolveClient(organizationId);
    if (!client) return 0;

    // StartedAt is the partition key, filtered on both sides of the dedup so
    // a windowed read prunes to the partitions the window covers.
    const result = await client.query({
      query: `
        SELECT toString(count()) AS Total
        FROM simulation_runs AS t
        WHERE t.TenantId IN ({projectIds:Array(String)})
          ${windowOn("t.StartedAt", since)}
          AND t.ArchivedAt IS NULL
          AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
            SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
            FROM simulation_runs
            WHERE TenantId IN ({projectIds:Array(String)})
              ${windowOn("StartedAt", since)}
            GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
          )
      `,
      query_params: params(projectIds, since),
      format: "JSONEachRow",
    });

    return await total(result);
  }

  async findTraceCount({
    organizationId,
    projectIds,
    since,
  }: InstanceUsageCountsInput): Promise<number> {
    if (projectIds.length === 0) return 0;

    const client = await this.resolveClient(organizationId);
    if (!client) return 0;

    const result = await client.query({
      query: `
        SELECT toString(count(DISTINCT TraceId)) AS Total
        FROM trace_summaries
        WHERE TenantId IN ({projectIds:Array(String)})
          ${windowOn("OccurredAt", since)}
      `,
      query_params: params(projectIds, since),
      format: "JSONEachRow",
    });

    return await total(result);
  }

  /**
   * Rows of `stored_spans`, which is the volume of telemetry the install
   * holds. Counted as written: a span re-ingested before its parts merged
   * counts twice, which is close enough for a figure whose point is the order
   * of magnitude. The lifetime read touches the tenant column alone, which is
   * the sort key and compresses to almost nothing, so it stays cheap on a
   * table of a billion rows; the windowed reads prune on StartTime.
   */
  async findSpanCount({
    organizationId,
    projectIds,
    since,
  }: InstanceUsageCountsInput): Promise<number> {
    if (projectIds.length === 0) return 0;

    const client = await this.resolveClient(organizationId);
    if (!client) return 0;

    const result = await client.query({
      query: `
        SELECT toString(count()) AS Total
        FROM stored_spans
        WHERE TenantId IN ({projectIds:Array(String)})
          ${windowOn("StartTime", since)}
      `,
      query_params: params(projectIds, since),
      format: "JSONEachRow",
    });

    return await total(result);
  }

  /**
   * The gateway's spend ledger: one row per request at its latest lifecycle
   * status, so a request count is a row count. FINAL keeps the read
   * replacement-aware, as every read of that table is. The ledger keeps
   * thirteen months, so the lifetime figure is the last thirteen months.
   */
  async findGatewaySpend({
    organizationId,
    projectIds,
    since,
  }: InstanceUsageCountsInput): Promise<InstanceGatewaySpend> {
    if (projectIds.length === 0) return { requests: 0, spendUsd: 0 };

    const client = await this.resolveClient(organizationId);
    if (!client) return { requests: 0, spendUsd: 0 };

    const result = await client.query({
      query: `
        SELECT toString(count()) AS Total,
               toString(sum(CostNanoUSD)) AS SpendNanoUsd
        FROM gateway_spend FINAL
        WHERE TenantId IN ({projectIds:Array(String)})
          ${windowOn("OccurredAt", since)}
      `,
      query_params: params(projectIds, since),
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      Total: string;
      SpendNanoUsd: string;
    }>;
    return {
      requests: parseInt(rows[0]?.Total ?? "0", 10),
      spendUsd: Number(rows[0]?.SpendNanoUsd ?? "0") / NANO_PER_USD,
    };
  }

  /**
   * Instant Eval runs. The table has no partition and one row per run, so
   * the lifetime read is a scan of a small table.
   */
  async findInstantEvalRunCount({
    organizationId,
    projectIds,
    since,
  }: InstanceUsageCountsInput): Promise<number> {
    if (projectIds.length === 0) return 0;

    const client = await this.resolveClient(organizationId);
    if (!client) return 0;

    const result = await client.query({
      query: `
        SELECT toString(count()) AS Total
        FROM instant_eval_runs FINAL
        WHERE TenantId IN ({projectIds:Array(String)})
          ${windowOn("CreatedAt", since)}
      `,
      query_params: params(projectIds, since),
      format: "JSONEachRow",
    });

    return await total(result);
  }

  /** Judgments those runs produced, one row each, pruned on CreatedAt. */
  async findInstantEvalJudgmentCount({
    organizationId,
    projectIds,
    since,
  }: InstanceUsageCountsInput): Promise<number> {
    if (projectIds.length === 0) return 0;

    const client = await this.resolveClient(organizationId);
    if (!client) return 0;

    const result = await client.query({
      query: `
        SELECT toString(count()) AS Total
        FROM instant_eval_judgments FINAL
        WHERE TenantId IN ({projectIds:Array(String)})
          ${windowOn("CreatedAt", since)}
      `,
      query_params: params(projectIds, since),
      format: "JSONEachRow",
    });

    return await total(result);
  }

  /**
   * Coding agent sessions, counted by session id so a re-folded session
   * counts once. The table is one aggregate row per session, with StartedAt
   * second in its sort key, so even the lifetime read is a walk of the index.
   */
  async findCodingAgentSessionCount({
    organizationId,
    projectIds,
    since,
  }: InstanceUsageCountsInput): Promise<number> {
    if (projectIds.length === 0) return 0;

    const client = await this.resolveClient(organizationId);
    if (!client) return 0;

    const result = await client.query({
      query: `
        SELECT toString(uniqExact(SessionId)) AS Total
        FROM coding_agent_sessions
        WHERE TenantId IN ({projectIds:Array(String)})
          ${windowOn("StartedAt", since)}
      `,
      query_params: params(projectIds, since),
      format: "JSONEachRow",
    });

    return await total(result);
  }

  async findFirstGatewayRequestAt({
    organizationId,
    projectIds,
  }: InstanceUsageCountsInput): Promise<Date | null> {
    return await this.firstAt({
      organizationId,
      projectIds,
      table: "gateway_spend",
      column: "OccurredAt",
    });
  }

  async findFirstInstantEvalRunAt({
    organizationId,
    projectIds,
  }: InstanceUsageCountsInput): Promise<Date | null> {
    return await this.firstAt({
      organizationId,
      projectIds,
      table: "instant_eval_runs",
      column: "CreatedAt",
    });
  }

  async findFirstCodingAgentSessionAt({
    organizationId,
    projectIds,
  }: InstanceUsageCountsInput): Promise<Date | null> {
    return await this.firstAt({
      organizationId,
      projectIds,
      table: "coding_agent_sessions",
      column: "StartedAt",
    });
  }

  /**
   * The earliest row of a table for these tenants, which is the day that rung
   * of getting started was reached. Null where it never was.
   *
   * The table and column are chosen from the three names above, never from
   * input, and the time column read is Delta-coded, so the read costs a few
   * bytes per row even lifetime.
   */
  private async firstAt({
    organizationId,
    projectIds,
    table,
    column,
  }: {
    organizationId: string;
    projectIds: string[];
    table: "gateway_spend" | "instant_eval_runs" | "coding_agent_sessions";
    column: "OccurredAt" | "CreatedAt" | "StartedAt";
  }): Promise<Date | null> {
    if (projectIds.length === 0) return null;

    const client = await this.resolveClient(organizationId);
    if (!client) return null;

    const result = await client.query({
      query: `
        SELECT toString(count()) AS Total,
               toString(toUnixTimestamp64Milli(min(${column}))) AS FirstMs
        FROM ${table}
        WHERE TenantId IN ({projectIds:Array(String)})
      `,
      query_params: { projectIds },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      Total: string;
      FirstMs: string;
    }>;
    if (parseInt(rows[0]?.Total ?? "0", 10) === 0) return null;
    return new Date(Number(rows[0]?.FirstMs ?? "0"));
  }
}

/** The one-row, one-column shape every count above comes back in. */
async function total(result: { json(): Promise<unknown> }): Promise<number> {
  const rows = (await result.json()) as Array<{ Total: string }>;
  return parseInt(rows[0]?.Total ?? "0", 10);
}
