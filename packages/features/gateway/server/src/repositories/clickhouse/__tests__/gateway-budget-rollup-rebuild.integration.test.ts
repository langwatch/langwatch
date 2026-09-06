/**
 * @vitest-environment node
 * History folded by an older rollup view must survive the rebuild that
 * replaced it. Spec: specs/ai-gateway/budgets.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { Prisma } from "@langwatch/prisma-client/generated";
import type { GatewayBudget, GatewayBudgetWindow } from "@langwatch/prisma-client/generated";

import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository.ts";
import {
  startMigratedGatewayClickHouse,
  type MigratedClickHouse,
} from "./support/migrated-clickhouse.harness.ts";
import { replayGooseMigrationUp, replayRollupRebuild } from "./support/goose-migration-replay.ts";

const suffix = nanoid(8);
const TENANT_ID = `proj-rebuild-${suffix}`;

/**
 * Only the date-boundary windows discriminate: MINUTE and HOUR stay aligned
 * on any whole-hour timezone offset, so a pre-rebuild debit on them lands in
 * the period the reader asks for either way.
 */
const PRE_WINDOWS: GatewayBudgetWindow[] = ["DAY", "WEEK", "MONTH"];

const DEBIT_USD = "0.0010000000";

function budgetFor(window: GatewayBudgetWindow): GatewayBudget {
  return {
    id: `bdg-pre-${window}-${suffix}`,
    organizationId: `org-${suffix}`,
    scopeType: "PROJECT",
    scopeId: `proj-pre-${window}-${suffix}`,
    name: `budget-${window}`,
    description: null,
    window,
    limitUsd: new Prisma.Decimal("0.0001"),
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

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

describe.skipIf(!enabled)("given spend recorded before the rollup rebuild", () => {
  const preBudgets = PRE_WINDOWS.map(budgetFor);
  const preOccurredAt = new Date();

  let endpoint: MigratedClickHouse;
  let repo: GatewayBudgetClickHouseRepository;
  let spendBeforeRebuild: Map<string, string>;
  let spendAfterRebuild: Map<string, string>;

  beforeAll(async () => {
    endpoint = await startMigratedGatewayClickHouse();
    repo = new GatewayBudgetClickHouseRepository(async () => endpoint.client);

    // Pre-upgrade state: the 00055 view truncates periods in the server
    // session timezone.
    await replayGooseMigrationUp({
      client: endpoint.client,
      fileName: "00055_gateway_budget_scope_totals_period_start.sql",
    });

    // Pre-upgrade history, folded as a Sao Paulo server would fold it: its
    // midnight is 03:00 UTC, so an unpinned toStartOfDay / toStartOfWeek /
    // toStartOfMonth lands three hours from every period the reader asks for.
    // The insert is synchronous so the view's SELECT runs in this session.
    await insertPreUpgradeDebits(endpoint.client, preBudgets, preOccurredAt);

    spendBeforeRebuild = await readSpend(repo, preBudgets, preOccurredAt);

    // The upgrade under test: the CURRENT rebuild, which pins the truncation
    // to UTC, keys the aggregate by budget, and re-derives every row from the
    // ledger. Replaying the newest rebuild rather than the one that first
    // fixed the timezone is what keeps this honest as the rollup evolves.
    await replayRollupRebuild(endpoint.client);

    spendAfterRebuild = await readSpend(repo, preBudgets, preOccurredAt);
  }, 300_000);

  describe("when the rebuild has not run yet", () => {
    /** @scenario Spend recorded before the rollup rebuild still counts after it */
    it.each(PRE_WINDOWS)("reads $0 on a %s budget whose ledger is not empty", (window) => {
      // The pre-rebuild read is the bug the rebuild exists for. If this reads
      // non-zero the fixture is not on the seam and the assertion below
      // proves nothing.
      const budget = preBudgets.find((b) => b.window === window)!;
      expect(Number.parseFloat(spendBeforeRebuild.get(budget.id) ?? "0")).toBe(0);
    });
  });

  describe("when the rebuild has run", () => {
    /** @scenario Spend recorded before the rollup rebuild still counts after it */
    it.each(PRE_WINDOWS)("reads the full pre-rebuild spend on a %s budget", (window) => {
      const budget = preBudgets.find((b) => b.window === window)!;
      expect(Number.parseFloat(spendAfterRebuild.get(budget.id) ?? "0")).toBe(
        Number.parseFloat(DEBIT_USD),
      );
    });
  });
});

async function readSpend(
  repo: GatewayBudgetClickHouseRepository,
  budgets: GatewayBudget[],
  at: Date,
): Promise<Map<string, string>> {
  const spend = await repo.getSpendForBudgets(TENANT_ID, budgets, at);

  return new Map(spend.map((row) => [row.budgetId, row.spentUsd]));
}

async function insertPreUpgradeDebits(
  client: ClickHouseClient,
  budgets: GatewayBudget[],
  occurredAt: Date,
): Promise<void> {
  await client.insert({
    table: "gateway_budget_ledger_events",
    values: budgets.map((budget) => ({
      TenantId: TENANT_ID,
      BudgetId: budget.id,
      Scope: "project",
      ScopeId: budget.scopeId,
      Window: budget.window,
      VirtualKeyId: `vk_${suffix}`,
      ProviderCredentialId: "",
      GatewayRequestId: `grq_pre_${budget.window}_${suffix}`,
      AmountUSD: DEBIT_USD,
      TokensInput: 300,
      TokensOutput: 150,
      TokensCacheRead: 0,
      TokensCacheWrite: 0,
      Model: "gpt-5-mini",
      ProviderSlot: "",
      DurationMS: 120,
      Status: "success",
      OccurredAt: occurredAt.getTime(),
      EventTimestamp: occurredAt.getTime(),
    })),
    format: "JSONEachRow",
    clickhouse_settings: { session_timezone: "America/Sao_Paulo" },
  });
}
