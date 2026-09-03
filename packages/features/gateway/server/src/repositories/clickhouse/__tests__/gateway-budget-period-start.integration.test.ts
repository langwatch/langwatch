/**
 * @vitest-environment node
 *
 * Spend written against a budget must be readable on that budget, for every
 * window a budget can be created with.
 *
 * Real ClickHouse, no mocks. A debit goes in through the same repository the
 * debits process uses, and comes back out through the same repository the
 * budgets UI, the gateway config bundle, and the per-end-user bucket poll
 * all read from.
 *
 * This is the regression guard for issue #6141. The rollup only returns a row
 * when the period the reader asks for is exactly the period the materialised
 * view bucketed the debit into. Those two lived in different files and drifted:
 * four of the six windows wrote into a bucket nothing ever read, so budgets on
 * them accrued nothing forever, never warned, and never blocked, while showing
 * a confident $0.00 spent. Any future drift fails here instead of in a
 * customer's gateway.
 *
 * The migration-replay regression (an older deployment's history surviving the
 * UTC-boundary rollup rebuild) is NOT ported here: it drove
 * `replayGooseMigrationUp` / `replayRollupRebuild` against a scratch
 * testcontainers ClickHouse, replaying goose migration files by hand. That
 * harness went with platform/app and has no equivalent against a shared,
 * already-migrated test ClickHouse — replaying an old migration file into it
 * would downgrade the live materialised view out from under every other
 * suite reading it concurrently. See the batch report for the scenario this
 * drops.
 */

import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  GatewayBudget,
  GatewayBudgetWindow,
} from "@langwatch/prisma-client/generated";
import { Prisma } from "@langwatch/prisma-client/generated";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support";
import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository";

const chUrl = testClickHouseUrl();

const suffix = nanoid(8);
const TENANT_ID = `proj-periodstart-${suffix}`;

const ALL_WINDOWS: GatewayBudgetWindow[] = [
  "MINUTE",
  "HOUR",
  "DAY",
  "WEEK",
  "MONTH",
  "TOTAL",
];

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
    currentPeriodStartedAt: new Date(),
    resetsAt: new Date(Date.now() + 86_400_000),
    lastResetAt: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: `usr-${suffix}`,
  } as GatewayBudget;
}

describe.skipIf(!chUrl)("given a debit recorded against a budget in ClickHouse", () => {
  const budgets = ALL_WINDOWS.map(budgetFor);
  let repo: GatewayBudgetClickHouseRepository;
  let spendByBudgetId: Map<string, string>;

  beforeAll(async () => {
    repo = new GatewayBudgetClickHouseRepository(async () =>
      createTestClickHouseClient(chUrl!),
    );

    // One pinned instant for every debit and for the read below. The
    // reader computes the current period from the instant it is handed;
    // deriving both sides from the same value keeps a run that spans a
    // MINUTE or HOUR boundary from reading a later period than it wrote.
    const occurredAt = new Date();
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
    it.each(
      ALL_WINDOWS,
    )("reports a %s budget as past its limit once spend exceeds it", (window) => {
      const budget = budgets.find((b) => b.window === window)!;
      const spent = Number.parseFloat(spendByBudgetId.get(budget.id)!);

      expect(spent).toBeGreaterThanOrEqual(Number.parseFloat(LIMIT_USD));
    });
  });

  describe("when the ClickHouse server does not run in UTC", () => {
    // The ledger's OccurredAt carries no timezone, so the view's period
    // truncation follows the server timezone unless the view pins one,
    // while currentPeriodStart always computes UTC boundaries. Setting
    // session_timezone on the insert evaluates the materialised view's
    // SELECT exactly as a server whose default timezone is
    // America/Sao_Paulo would, without needing a second ClickHouse.
    // Sao Paulo midnight is 03:00 UTC, so an unpinned toStartOfDay /
    // toStartOfWeek / toStartOfMonth lands three hours away from every
    // period the reader asks for. MINUTE and HOUR stay aligned on any
    // whole-hour offset, so only the three date-boundary windows can
    // discriminate.
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

    const tzOccurredAt = new Date();

    beforeAll(async () => {
      const client = createTestClickHouseClient(chUrl!);
      const occurredAt = tzOccurredAt.getTime();
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
    it.each(
      TZ_WINDOWS,
    )("still reports non-zero spend on a %s budget", async (window) => {
      const budget = tzBudgets.find((b) => b.window === window)!;
      const spend = await repo.getSpendForBudgets(
        TENANT_ID,
        [budget],
        tzOccurredAt,
      );

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
      const rows = (await result.json()) as Array<{
        Window: string;
        buckets: string;
      }>;

      // Every window produced a rollup bucket, and getSpendForBudgets above
      // found all of them. A window present here but missing from the spend
      // map is the exact drift this test exists to catch.
      expect(rows.map((r) => r.Window).sort()).toEqual([...ALL_WINDOWS].sort());
    });
  });
});
