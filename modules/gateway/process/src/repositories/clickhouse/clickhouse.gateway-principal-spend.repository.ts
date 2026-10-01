import {
  type GatewayPrincipalDailySpend,
  type GatewayPrincipalModelSpend,
  type GatewayPrincipalSpendSummary,
  type GatewayPrincipalSpendWindow,
  nanoUsdToDecimalString,
  parseSummedNanoUsd,
} from "@langwatch/gateway-contract";

import type { GatewayClickHouseResolver } from "../../app/gateway.members.ts";
import { GatewayPrincipalSpendRepository } from "../gateway-principal-spend.repository.ts";

const SETTINGS = { max_bytes_before_external_group_by: 500_000_000 };

/**
 * One row per gateway request: every row a request writes carries its own cost, tokens and model,
 * so `any()` is exact and N budgets' rows collapse to one. Money sums the integer nano column;
 * `Status = 'success'` matches every other ledger read. Main's governance personal-usage query.
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

type PrincipalSpendInput = {
  tenantId: string;
  userId: string;
  window: GatewayPrincipalSpendWindow;
};
type SummaryRow = {
  TotalNanoCost: string | null;
  RequestCount: number | string | null;
  PromptTokens: number | string | null;
  CompletionTokens: number | string | null;
};
type TopModelRow = { Name: string; Requests: number | string | null };
type DailyRow = { Day: string; SpentNanoUsd: string; Requests: number | string };
type ModelRow = { Label: string; SpentNanoUsd: string; Requests: number | string };

/** A summed Int64 nano-USD string as USD, read digit by digit so no float division drifts it. */
function summedNanoUsdToUsd(value: unknown): number {
  return Number(nanoUsdToDecimalString(parseSummedNanoUsd(value)));
}

function paramsFor(input: PrincipalSpendInput): Record<string, string | number> {
  return {
    tenantId: input.tenantId,
    userId: input.userId,
    fromMs: input.window.startMs,
    toMs: input.window.endMs,
  };
}

export class ClickHouseGatewayPrincipalSpendRepository extends GatewayPrincipalSpendRepository {
  readonly #resolveClient: GatewayClickHouseResolver;

  private constructor(resolveClient: GatewayClickHouseResolver) {
    super();
    this.#resolveClient = resolveClient;
  }

  static create(
    resolveClient: GatewayClickHouseResolver,
  ): ClickHouseGatewayPrincipalSpendRepository {
    return new ClickHouseGatewayPrincipalSpendRepository(resolveClient);
  }

  async getSummary(input: PrincipalSpendInput): Promise<GatewayPrincipalSpendSummary> {
    const client = await this.#resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          toString(sum(RequestAmountNanoUSD)) AS TotalNanoCost,
          count()                             AS RequestCount,
          sum(RequestTokensInput)             AS PromptTokens,
          sum(RequestTokensOutput)            AS CompletionTokens
        FROM (${PRINCIPAL_REQUESTS_SUBQUERY})
      `,
      query_params: paramsFor(input),
      format: "JSONEachRow",
      clickhouse_settings: SETTINGS,
    });
    const [row] = await result.json<SummaryRow>();
    if (!row || !Number(row.RequestCount)) {
      return {
        totalCost: 0,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        topModel: null,
      };
    }

    const topModelResult = await client.query({
      query: `
        SELECT
          RequestModel AS Name,
          count()       AS Requests
        FROM (${PRINCIPAL_REQUESTS_SUBQUERY})
        GROUP BY RequestModel
        ORDER BY Requests DESC
        LIMIT 1
      `,
      query_params: paramsFor(input),
      format: "JSONEachRow",
      clickhouse_settings: SETTINGS,
    });
    const [topRow] = await topModelResult.json<TopModelRow>();

    return {
      totalCost: summedNanoUsdToUsd(row.TotalNanoCost),
      requestCount: Number(row.RequestCount) || 0,
      promptTokens: Number(row.PromptTokens) || 0,
      completionTokens: Number(row.CompletionTokens) || 0,
      topModel: topRow ? { name: topRow.Name, requests: Number(topRow.Requests) || 0 } : null,
    };
  }

  async findDailySpend(input: PrincipalSpendInput): Promise<GatewayPrincipalDailySpend[]> {
    const client = await this.#resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          toDate(RequestOccurredAt)           AS Day,
          toString(sum(RequestAmountNanoUSD)) AS SpentNanoUsd,
          count()                             AS Requests
        FROM (${PRINCIPAL_REQUESTS_SUBQUERY})
        GROUP BY Day
        ORDER BY Day
      `,
      query_params: paramsFor(input),
      format: "JSONEachRow",
      clickhouse_settings: SETTINGS,
    });

    return (await result.json<DailyRow>()).map((row) => {
      const spentUsd = summedNanoUsdToUsd(row.SpentNanoUsd);
      return { day: row.Day, spentUsd, billedUsd: spentUsd, requests: Number(row.Requests) || 0 };
    });
  }

  async findModelSpend(input: PrincipalSpendInput): Promise<GatewayPrincipalModelSpend[]> {
    const client = await this.#resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        SELECT
          RequestModel                        AS Label,
          toString(sum(RequestAmountNanoUSD)) AS SpentNanoUsd,
          count()                             AS Requests
        FROM (${PRINCIPAL_REQUESTS_SUBQUERY})
        GROUP BY Label
        ORDER BY sum(RequestAmountNanoUSD) DESC
      `,
      query_params: paramsFor(input),
      format: "JSONEachRow",
      clickhouse_settings: SETTINGS,
    });

    return (await result.json<ModelRow>()).map((row) => {
      const spentUsd = summedNanoUsdToUsd(row.SpentNanoUsd);
      return {
        label: row.Label,
        spentUsd,
        billedUsd: spentUsd,
        requests: Number(row.Requests) || 0,
      };
    });
  }
}
