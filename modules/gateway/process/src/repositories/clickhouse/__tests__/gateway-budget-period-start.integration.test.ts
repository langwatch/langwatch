/**
 * @vitest-environment node
 * Regression guard for #6141: rollup returns a row only when the asked
 * period matches the bucketed period — four of six windows used to drift.
 */

import { nowInstant } from "@langwatch/time";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import type { GatewayBudget, GatewayBudgetWindow } from "@langwatch/gateway-contract";
import { Prisma } from "@langwatch/prisma-client/generated";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";
import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository.ts";

const chUrl = testClickHouseUrl();

const suffix = nanoid(8);
const TENANT_ID = `proj-periodstart-${suffix}`;

const ALL_WINDOWS: GatewayBudgetWindow[] = ["MINUTE", "HOUR", "DAY", "WEEK", "MONTH", "TOTAL"];

const DEBIT_USD = "0.0010000000";
// The BudgetDebitRow the repo actually takes: same amount as DEBIT_USD,
// stated once as the integer nano-USD the repository derives AmountUSD from.
const DEBIT_NANO_USD = 1_000_000;
const LIMIT_USD = "0.0001";

function budgetFor(window: GatewayBudgetWindow): GatewayBudget {
  return {
    id: `bdg-${window}-${suffix}`,
    organizationId: `org-${suffix}`,
    scopeType: "PROJECT",
    scopeId: TENANT_ID,
    name: `budget-${window}`,
    description: null,
    window,
    limitUsd: new Prisma.Decimal(LIMIT_USD),
    onBreach: "BLOCK",
    timezone: null,
    spentUsd: new Prisma.Decimal("0"),
    currentPeriodStartedAt: nowInstant(),
    resetsAt: nowInstant().add({ milliseconds: 86_400_000 }),
    lastResetAt: null,
    archivedAt: null,
    createdAt: nowInstant(),
    updatedAt: nowInstant(),
    createdById: `usr-${suffix}`,
    providerKey: null,
    externalId: null,
    metadata: null,
    cycleAnchorAt: null,
    managedByVirtualKeyId: null,
  };
}

describe.skipIf(!chUrl)("given a debit recorded against a budget in ClickHouse", () => {
  const budgets = ALL_WINDOWS.map(budgetFor);
  let repo: GatewayBudgetClickHouseRepository;
  let spendByBudgetId: Map<string, string>;

  beforeAll(async () => {
    repo = new GatewayBudgetClickHouseRepository(async () => createTestClickHouseClient(chUrl!));

    // One pinned instant for every debit and for the read below. The
    // reader computes the current period from the instant it is handed;
    // deriving both sides from the same value keeps a run that spans a
    // MINUTE or HOUR boundary from reading a later period than it wrote.
    const occurredAt = nowInstant();
    for (const budget of budgets) {
      await repo.insertDebit([
        {
          tenantId: TENANT_ID,
          budgetId: budget.id,
          scope: budget.scopeType,
          scopeId: budget.scopeId,
          window: budget.window,
          virtualKeyId: `vk_${suffix}`,
          gatewayRequestId: `grq_${budget.window}_${nanoid()}`,
          amountNanoUsd: DEBIT_NANO_USD,
          tokensInput: 300,
          tokensOutput: 150,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          model: "gpt-5-mini",
          durationMs: 120,
          status: "SUCCESS",
          occurredAt,
        },
      ]);
    }

    const spend = await repo.getSpendForBudgets(TENANT_ID, budgets, occurredAt);
    spendByBudgetId = new Map(spend.map((s) => [s.budgetId, s.spentUsd]));
  }, 120_000);

  describe("when the spend is read back on each window", () => {
    /** @scenario "Spend recorded against a budget is visible on that budget" */
    it.each(ALL_WINDOWS)("reports non-zero spend on a %s budget", (window) => {
      const budget = budgets.find((b) => b.window === window)!;
      const spent = spendByBudgetId.get(budget.id);

      expect(spent).toBeDefined();
      expect(Number.parseFloat(spent!)).toBeGreaterThan(0);
    });

    /** @scenario "Spend recorded against a budget is visible on that budget" */
    it.each(ALL_WINDOWS)(
      "reports a %s budget as past its limit once spend exceeds it",
      (window) => {
        const budget = budgets.find((b) => b.window === window)!;
        const spent = Number.parseFloat(spendByBudgetId.get(budget.id)!);

        expect(spent).toBeGreaterThanOrEqual(Number.parseFloat(LIMIT_USD));
      },
    );
  });

  describe("when the ClickHouse server does not run in UTC", () => {
    // Simulates a non-UTC ClickHouse (e.g. America/Sao_Paulo) without a second
    // instance: session_timezone on the insert evaluates the view's SELECT as
    // that server would. Only DAY/WEEK/MONTH can discriminate the drift — an
    // unpinned toStartOf* lands hours away from the UTC boundary the reader uses.
    const TZ_WINDOWS: GatewayBudgetWindow[] = ["DAY", "WEEK", "MONTH"];
    // Distinct scope ids: the rollup groups by (TenantId, Scope, ScopeId,
    // Window, PeriodStart), so sharing the outer fixture's scope id would
    // let these reads find the outer debit's UTC bucket and pass without
    // exercising the timezone seam at all.
    const tzBudgets = TZ_WINDOWS.map((window) => ({
      ...budgetFor(window),
      id: `bdg-tz-${window}-${suffix}`,
      scopeId: `proj-tz-${window}-${suffix}`,
    }));

    const tzOccurredAt = nowInstant();

    beforeAll(async () => {
      const client = createTestClickHouseClient(chUrl!);
      const occurredAt = tzOccurredAt.epochMilliseconds;
      await client.insert({
        table: "gateway_budget_ledger_events",
        values: tzBudgets.map((budget) => ({
          TenantId: TENANT_ID,
          BudgetId: budget.id,
          Scope: "project",
          ScopeId: budget.scopeId,
          // windowToClickHouse passes the enum through unchanged.
          Window: budget.window,
          VirtualKeyId: `vk_${suffix}`,
          ProviderCredentialId: "",
          GatewayRequestId: `grq_tz_${budget.window}_${suffix}`,
          AmountUSD: DEBIT_USD,
          TokensInput: 300,
          TokensOutput: 150,
          TokensCacheRead: 0,
          TokensCacheWrite: 0,
          Model: "gpt-5-mini",
          ProviderSlot: "",
          DurationMS: 120,
          Status: "success",
          OccurredAt: occurredAt,
          EventTimestamp: occurredAt,
        })),
        format: "JSONEachRow",
        // Synchronous insert: the materialised view's SELECT then runs in
        // this session, under this session_timezone, exactly as it would
        // on a server whose default timezone is America/Sao_Paulo. An
        // async insert is flushed by a background thread that carries the
        // server defaults instead, which would defeat the simulation.
        clickhouse_settings: {
          session_timezone: "America/Sao_Paulo",
        },
      });
    }, 120_000);

    /** @scenario "Spend stays visible when the ClickHouse server does not run in UTC" */
    it.each(TZ_WINDOWS)("still reports non-zero spend on a %s budget", async (window) => {
      const budget = tzBudgets.find((b) => b.window === window)!;
      const spend = await repo.getSpendForBudgets(TENANT_ID, [budget], tzOccurredAt);

      expect(Number.parseFloat(spend[0]!.spentUsd)).toBeGreaterThan(0);
    });
  });

  describe("when comparing the periods the two sides use", () => {
    it("buckets every window into a period the read path asks for", async () => {
      const client = createTestClickHouseClient(chUrl!);
      const result = await client.query({
        query: `
          SELECT Window, count() AS buckets
          FROM gateway_budget_scope_totals
          WHERE TenantId = {tenantId:String}
          GROUP BY Window
        `,
        query_params: { tenantId: TENANT_ID },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as {
        Window: string;
        buckets: string;
      }[];

      // Every window produced a rollup bucket, and getSpendForBudgets above
      // found all of them. A window present here but missing from the spend
      // map is the exact drift this test exists to catch.
      expect(rows.map((r) => r.Window).toSorted()).toEqual([...ALL_WINDOWS].toSorted());
    });
  });
});
