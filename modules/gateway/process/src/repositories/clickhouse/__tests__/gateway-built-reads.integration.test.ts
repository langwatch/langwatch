/** @vitest-environment node */

/**
 * ADR-202 slice 7: the principal-spend and open-admission reads, built by the typed builder, answer
 * real rows on the migrated schema: the principal reads as the reader under one tenant's setting,
 * the settlement sweep as the system identity across every tenant.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseGatewayOpenAdmissionsRepository } from "../clickhouse.gateway-open-admissions.repository.ts";
import { ClickHouseGatewayPrincipalSpendRepository } from "../clickhouse.gateway-principal-spend.repository.ts";
import { gatewayClickHouseReading } from "./support/clickhouse-endpoint.support.ts";
import {
  type MigratedClickHouse,
  startMigratedGatewayClickHouse,
} from "./support/migrated-clickhouse.harness.ts";

const run = nanoid(8);
const tenantId = `built-reads-${run}`;
const otherTenantId = `built-reads-other-${run}`;
/** Ten days back at 08:00 UTC: inside gateway_spend's 13-month TTL, so the insert keeps it. */
const BASE = Math.floor((Date.now() - 10 * 86_400_000) / 86_400_000) * 86_400_000 + 8 * 3_600_000;
const HOUR = 3_600_000;
const at = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

describe("gateway's built reads on the migrated schema", () => {
  let migrated: MigratedClickHouse;

  beforeAll(async () => {
    migrated = await startMigratedGatewayClickHouse();
    const spend = (input: { tenant: string; id: string; status: string; version: number }) => ({
      TenantId: input.tenant,
      GatewayRequestId: input.id,
      OrganizationId: "org-1",
      VirtualKeyId: "vk-1",
      Model: "openai/gpt-5-mini",
      Status: input.status,
      OccurredAt: at(BASE),
      EventTimestamp: input.version,
    });
    await migrated.client.insert({
      table: "gateway_spend",
      format: "JSONEachRow",
      values: [
        spend({ tenant: tenantId, id: `open-${run}`, status: "admitted", version: 1 }),
        spend({ tenant: otherTenantId, id: `other-${run}`, status: "admitted", version: 1 }),
        spend({ tenant: tenantId, id: `done-${run}`, status: "admitted", version: 1 }),
        spend({ tenant: tenantId, id: `done-${run}`, status: "confirmed", version: 2 }),
      ],
    });
    const debit = (input: { budget: string; id: string; nano: number; model: string }) => ({
      TenantId: tenantId,
      BudgetId: input.budget,
      Scope: "principal",
      ScopeId: "user-1",
      Window: "DAY",
      VirtualKeyId: "vk-1",
      GatewayRequestId: input.id,
      AmountUSD: input.nano / 1e9,
      AmountNanoUSD: input.nano,
      TokensInput: 3,
      TokensOutput: 4,
      Model: input.model,
      ProviderSlot: "primary",
      Status: "success",
      OccurredAt: at(BASE),
      EventTimestamp: 1,
    });
    await migrated.client.insert({
      table: "gateway_budget_ledger_events",
      format: "JSONEachRow",
      values: [
        debit({ budget: "b-1", id: `r1-${run}`, nano: 1_500_000_000, model: "m-a" }),
        debit({ budget: "b-2", id: `r1-${run}`, nano: 1_500_000_000, model: "m-a" }),
        debit({ budget: "b-1", id: `r2-${run}`, nano: 500_000_000, model: "m-b" }),
      ],
    });
  }, 240_000);

  afterAll(async () => {
    if (!migrated) return;
    for (const table of ["gateway_spend", "gateway_budget_ledger_events"]) {
      await migrated.client.command({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({tenants:Array(String)})`,
        query_params: { tenants: [tenantId, otherTenantId] },
        clickhouse_settings: { mutations_sync: "1" },
      });
    }
  });

  it("collapses a principal's budgets to one row per request on the reader", async () => {
    const repository = ClickHouseGatewayPrincipalSpendRepository.create(
      gatewayClickHouseReading(migrated.reading),
    );
    const input = {
      tenantId,
      userId: "user-1",
      window: { startMs: BASE - HOUR, endMs: BASE + HOUR },
    };

    await expect(repository.getSummary(input)).resolves.toEqual({
      totalCost: 2,
      requestCount: 2,
      promptTokens: 6,
      completionTokens: 8,
      topModel: { name: expect.stringMatching(/^m-[ab]$/), requests: 1 },
    });
    await expect(repository.findDailySpend(input)).resolves.toEqual([
      { day: new Date(BASE).toISOString().slice(0, 10), spentUsd: 2, billedUsd: 2, requests: 2 },
    ]);
    await expect(repository.findModelSpend(input)).resolves.toEqual([
      { label: "m-a", spentUsd: 1.5, billedUsd: 1.5, requests: 1 },
      { label: "m-b", spentUsd: 0.5, billedUsd: 0.5, requests: 1 },
    ]);
  }, 60_000);

  it("finds every tenant's still-admitted request past grace, never a resolved one", async () => {
    const session = await gatewayClickHouseReading(migrated.reading)("");
    const found = await ClickHouseGatewayOpenAdmissionsRepository.create(
      session,
    ).findOpenAdmissions({ now: BASE + 2 * HOUR, graceMs: HOUR, lookbackMs: 3 * HOUR });

    expect(found.map((each) => each.gatewayRequestId).toSorted()).toEqual(
      [`open-${run}`, `other-${run}`].toSorted(),
    );
    expect(found[0]).toMatchObject({ admittedAtMs: BASE, labels: [] });
  }, 60_000);
});
