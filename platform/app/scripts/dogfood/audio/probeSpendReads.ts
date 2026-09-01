/**
 * The audio spend probe's reads: the spend record, the budget ledger, the
 * budget total and the trace explorer's cost.
 *
 * Every read is bounded by the run's own start instant. gateway_spend and
 * gateway_budget_ledger_events are partitioned by their time column and read
 * under FINAL, so an unbounded predicate scans every partition, cold storage
 * included, for rows this run created seconds ago.
 */

import { getClickHouseClientForTenant } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import { GatewayBudgetClickHouseRepository } from "@langwatch/gateway-server/testing";

/** The quantity columns migration 00078 adds. */
export const REQUIRED_COLUMNS = [
  "CharsInput",
  "AudioMS",
  "TokensCacheWrite1h",
  "TokensInputAudio",
  "TokensOutputAudio",
];

/** What one probe run needs to find its own rows again. */
export interface ProbeScope {
  vkId: string;
  budgetId: string;
  projectId: string;
  /** Every read is bounded to this instant so ClickHouse prunes partitions. */
  startedAt: Date;
}

export interface SpendRow {
  GatewayRequestId: string;
  TraceId: string;
  Model: string;
  Status: string;
  CharsInput: string;
  TokensInput: string;
  TokensOutput: string;
  CostNanoUSD: string;
}

export interface LedgerDebit {
  Status: string;
  AmountNanoUSD: string;
}

export async function clickhouse(projectId: string) {
  const client = await getClickHouseClientForTenant(projectId);
  if (!client) throw new Error("no ClickHouse client available");
  return client;
}

/**
 * Abort before spending money if the migration has not landed: without the
 * columns the probe would measure the defect it is meant to disprove and
 * blame the code.
 */
export async function assertQuantityColumns(projectId: string): Promise<void> {
  const client = await clickhouse(projectId);
  const result = await client.query({
    query: "DESCRIBE TABLE gateway_spend",
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ name: string }>;
  const present = new Set(rows.map((r) => r.name));
  const missing = REQUIRED_COLUMNS.filter((c) => !present.has(c));
  if (missing.length > 0) {
    throw new Error(
      `gateway_spend is missing ${missing.join(", ")}. Apply migration ` +
        "00078_gateway_spend_billable_quantities.sql before probing.",
    );
  }
}

export async function readSpendRows(scope: ProbeScope): Promise<SpendRow[]> {
  const client = await clickhouse(scope.projectId);
  const result = await client.query({
    query: `
      SELECT GatewayRequestId, TraceId, Model, Status,
             toString(CharsInput) AS CharsInput,
             toString(TokensInput) AS TokensInput,
             toString(TokensOutput) AS TokensOutput,
             toString(CostNanoUSD) AS CostNanoUSD
      FROM gateway_spend FINAL
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= {since:DateTime64(3)}
        AND VirtualKeyId = {vkId:String}
        AND Status IN ('confirmed', 'failed')
    `,
    query_params: {
      tenantId: scope.projectId,
      vkId: scope.vkId,
      since: scope.startedAt,
    },
    format: "JSONEachRow",
  });
  return (await result.json()) as SpendRow[];
}

export async function readLedgerDebits(scope: ProbeScope): Promise<LedgerDebit[]> {
  const client = await clickhouse(scope.projectId);
  const result = await client.query({
    query: `
      SELECT Status, toString(AmountNanoUSD) AS AmountNanoUSD
      FROM gateway_budget_ledger_events FINAL
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= {since:DateTime64(3)}
        AND BudgetId = {budgetId:String}
    `,
    query_params: {
      tenantId: scope.projectId,
      budgetId: scope.budgetId,
      since: scope.startedAt,
    },
    format: "JSONEachRow",
  });
  return (await result.json()) as LedgerDebit[];
}

export async function readBudgetSpendNanoUsd(scope: ProbeScope): Promise<number> {
  const repo = new GatewayBudgetClickHouseRepository(clickhouse);
  const budget = await prisma.gatewayBudget.findUniqueOrThrow({
    where: { id: scope.budgetId },
  });
  const [spend] = await repo.getSpendForBudgetsAcrossTenants([scope.projectId], [budget]);
  return spend?.spentNanoUsd ?? 0;
}

export async function readTraceCostUsd(
  scope: ProbeScope,
  traceId: string,
): Promise<number | null> {
  const client = await clickhouse(scope.projectId);
  const result = await client.query({
    query: `
      SELECT toString(TotalCost) AS TotalCost
      FROM trace_summaries FINAL
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= {since:DateTime64(3)}
        AND TraceId = {traceId:String}
      LIMIT 1
    `,
    query_params: {
      tenantId: scope.projectId,
      traceId,
      since: scope.startedAt,
    },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ TotalCost: string | null }>;
  const raw = rows[0]?.TotalCost;
  return raw == null || raw === "\\N" ? null : Number(raw);
}
