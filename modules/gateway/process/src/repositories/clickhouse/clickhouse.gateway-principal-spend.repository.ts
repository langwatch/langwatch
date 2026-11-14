import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import {
  type GatewayPrincipalDailySpend,
  type GatewayPrincipalModelSpend,
  type GatewayPrincipalSpendSummary,
  type GatewayPrincipalSpendWindow,
  nanoUsdToDecimalString,
  parseSummedNanoUsd,
} from "@langwatch/gateway-contract";

import { GatewayPrincipalSpendRepository } from "../gateway-principal-spend.repository.ts";
import { gatewayBudgetLedgerEvents as ledger } from "./clickhouse.gateway-budget-ledger-events.table.ts";
import type { GatewayClickHouseResolver } from "./clickhouse.gateway-session.store.ts";

const SETTINGS = { max_bytes_before_external_group_by: 500_000_000 };

type PrincipalSpendInput = {
  tenantId: string;
  userId: string;
  window: GatewayPrincipalSpendWindow;
};

/** A summed Int64 nano-USD string as USD, read digit by digit so no float division drifts it. */
function summedNanoUsdToUsd(value: unknown): number {
  return Number(nanoUsdToDecimalString(parseSummedNanoUsd(value)));
}

/**
 * One row per gateway request: every row a request writes carries its own cost, tokens and model,
 * so `any()` is exact and N budgets' rows collapse to one. Money sums the integer nano column;
 * `Status = 'success'` matches every other ledger read. Main's governance personal-usage query.
 */
function principalRequests({ tenantId, userId, window }: PrincipalSpendInput) {
  const scope = tenantScope.single({ tenantId });
  const requests = clickhouseRead({ scope })
    .from(ledger)
    .select({
      RequestAmountNanoUSD: fn.any(ledger.AmountNanoUSD),
      RequestTokensInput: fn.any(ledger.TokensInput),
      RequestTokensOutput: fn.any(ledger.TokensOutput),
      RequestModel: fn.any(ledger.Model),
      RequestOccurredAt: fn.any(ledger.OccurredAt),
    })
    .where(({ and, eq, gte, lt }) =>
      and(
        eq(ledger.Scope, "principal"),
        eq(ledger.ScopeId, userId),
        eq(ledger.Status, "success"),
        gte(ledger.OccurredAt, window.startMs),
        lt(ledger.OccurredAt, window.endMs),
      ),
    )
    .groupBy(ledger.GatewayRequestId)
    .as("requests");
  return { requests, start: clickhouseRead({ scope }).from(requests) };
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
    const summary = principalRequests(input);
    const { rows } = await client.read({
      statement: summary.start
        .select({
          TotalNanoCost: fn.toString(fn.sum(summary.requests.RequestAmountNanoUSD)),
          RequestCount: fn.count(),
          PromptTokens: fn.sum(summary.requests.RequestTokensInput),
          CompletionTokens: fn.sum(summary.requests.RequestTokensOutput),
        })
        .settings(SETTINGS)
        .build(),
    });
    const [row] = rows;
    if (!row || !Number(row.RequestCount)) {
      return {
        totalCost: 0,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        topModel: null,
      };
    }

    const top = principalRequests(input);
    const { rows: topRows } = await client.read({
      statement: top.start
        .select({ Name: top.requests.RequestModel, Requests: fn.count() })
        .groupBy(top.requests.RequestModel)
        .orderBy(fn.count(), "DESC")
        .limit(1)
        .settings(SETTINGS)
        .build(),
    });
    const [topRow] = topRows;

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
    const { requests, start } = principalRequests(input);
    const day = fn.toDate(requests.RequestOccurredAt);
    const { rows } = await client.read({
      statement: start
        .select({
          Day: day,
          SpentNanoUsd: fn.toString(fn.sum(requests.RequestAmountNanoUSD)),
          Requests: fn.count(),
        })
        .groupBy(day)
        .orderBy(day, "ASC")
        .settings(SETTINGS)
        .build(),
    });

    return rows.map((row) => {
      const spentUsd = summedNanoUsdToUsd(row.SpentNanoUsd);
      return { day: row.Day, spentUsd, billedUsd: spentUsd, requests: Number(row.Requests) || 0 };
    });
  }

  async findModelSpend(input: PrincipalSpendInput): Promise<GatewayPrincipalModelSpend[]> {
    const client = await this.#resolveClient(input.tenantId);
    const { requests, start } = principalRequests(input);
    const { rows } = await client.read({
      statement: start
        .select({
          Label: requests.RequestModel,
          SpentNanoUsd: fn.toString(fn.sum(requests.RequestAmountNanoUSD)),
          Requests: fn.count(),
        })
        .groupBy(requests.RequestModel)
        .orderBy(fn.sum(requests.RequestAmountNanoUSD), "DESC")
        .settings(SETTINGS)
        .build(),
    });

    return rows.map((row) => {
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
