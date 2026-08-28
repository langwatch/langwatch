/**
 * @vitest-environment node
 *
 * Pulled provider cost is visible, attributed, correct under restatement —
 * and structurally incapable of blocking a request.
 *
 * Real Postgres + real ClickHouse, no mocks. Cost is written by the real
 * process manager through the real repository, and read back both through the
 * dedicated pulled read and — for the enforcement gate — through
 * `GatewayService.check`, which is the actual pre-request decision the
 * gateway makes. Asserting on anything less than `check` would prove that a
 * number looked right, not that a customer's request was still served.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 * Decision: ADR-088.
 */
import type { RecordPulledUsageCommand } from "@langwatch/enterprise-governance-contract";
import {
  PulledUsageEventingAdapter,
  PulledUsageLedgerPort,
  PulledUsageLedgerProcess,
  type PulledUsageLedgerRow,
} from "@langwatch/enterprise-governance-server";
import { EventSourcing, InMemoryProcessStore, mapCommands } from "@langwatch/eventing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getClickHouseClientForTenant } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import {
  GatewayBudgetClickHouseRepository,
  PULLED_USAGE_SCOPE,
} from "@langwatch/gateway-server";
import { GatewayService } from "@langwatch/gateway-server";

const suffix = nanoid(8);
const ORG_ID = `org-pulled-${suffix}`;
const TEAM_ID = `team-pulled-${suffix}`;
/** The org's hidden governance project — the storage tenant, not the owner. */
const GOV_PROJECT_ID = `proj-pulled-gov-${suffix}`;
/** A real project, where gateway traffic for the same team lands. */
const APP_PROJECT_ID = `proj-pulled-app-${suffix}`;
const USER_ID = `usr-pulled-${suffix}`;
const TEAM_VK = `vk_pulled_${suffix}`;
const TEAM_BUDGET_ID = `bdg-pulled-team-${suffix}`;

/** A team budget with almost nothing left, so anything more would breach. */
const TEAM_LIMIT_USD = "1";
const NEARLY_SPENT_NANO = 990_000_000; // $0.99 of the $1 limit.

const WINDOW_FROM = new Date("2026-08-01T00:00:00.000Z");
const WINDOW_TO = new Date("2026-09-01T00:00:00.000Z");
const BUCKET_AT = new Date("2026-08-03T00:00:00.000Z");

let chRepo: GatewayBudgetClickHouseRepository;
let service: GatewayService;
let eventSourcing: EventSourcing | undefined;
let writePulledUsage: (payload: PulledUsageWrite) => Promise<void>;

type PulledUsageWrite = {
  restatement_key: string;
  tenant_id: string;
  scope_id: string;
  organization_id: string;
  team_id: string | null;
  model: string;
  cost_nano_usd: number;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  occurred_at_ms: number;
  observed_at_ms: number;
};

class ClickHousePulledUsageLedgerPort extends PulledUsageLedgerPort {
  constructor(private readonly repository: GatewayBudgetClickHouseRepository) {
    super();
  }

  insert(rows: PulledUsageLedgerRow[]): Promise<void> {
    return this.repository.insertPulledUsageRows(rows);
  }
}

/** One pulled usage item, as the process manager mints it. */
function pulledItem(options: {
  restatementKey: string;
  scopeId: string;
  costNanoUsd: number;
  teamId?: string | null;
  observedAt: Date;
  tokensInput?: number;
}): PulledUsageWrite {
  return {
    restatement_key: options.restatementKey,
    tenant_id: GOV_PROJECT_ID,
    scope_id: options.scopeId,
    organization_id: ORG_ID,
    team_id: options.teamId === undefined ? TEAM_ID : options.teamId,
    model: "anthropic/claude-sonnet-5",
    cost_nano_usd: options.costNanoUsd,
    tokens_input: options.tokensInput ?? 1_000,
    tokens_output: 200,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    occurred_at_ms: BUCKET_AT.getTime(),
    observed_at_ms: options.observedAt.getTime(),
  };
}

/** What the dedicated pulled read reports for a scope over the window. */
function pulledTotalsFor(scopeIds: string[]) {
  return chRepo.readPulledUsageTotals({
    tenantId: GOV_PROJECT_ID,
    scopeIds,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });
}

/** A gateway debit for the same team, written the way the spend spine does. */
async function writeGatewayDebit(costNanoUsd: number): Promise<void> {
  const budget = await prisma.gatewayBudget.findUniqueOrThrow({
    where: { id: TEAM_BUDGET_ID },
  });
  await chRepo.insertDebitsForBudgets([
    {
      tenantId: APP_PROJECT_ID,
      budgetId: budget.id,
      scope: budget.scopeType,
      scopeId: budget.scopeId,
      window: budget.window,
      virtualKeyId: TEAM_VK,
      gatewayRequestId: `grq_${nanoid()}`,
      amountNanoUsd: costNanoUsd,
      tokensInput: 300,
      tokensOutput: 150,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      model: "gpt-5-mini",
      status: "SUCCESS",
      occurredAt: new Date(),
    },
  ]);
}

/** The pre-request decision the gateway actually makes for this team. */
function checkTeamRequest(projectedCostUsd: number | string) {
  return service.check({
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    projectId: APP_PROJECT_ID,
    virtualKeyId: TEAM_VK,
    principalUserId: USER_ID,
    projectedCostUsd,
  });
}

beforeAll(async () => {
  await startTestContainers();

  await prisma.organization.create({
    data: { id: ORG_ID, name: `Org ${suffix}`, slug: ORG_ID },
  });
  await prisma.team.create({
    data: {
      id: TEAM_ID,
      name: `Team ${suffix}`,
      slug: TEAM_ID,
      organizationId: ORG_ID,
    },
  });
  for (const id of [GOV_PROJECT_ID, APP_PROJECT_ID]) {
    await prisma.project.create({
      data: {
        id,
        name: id,
        slug: id,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${id}`,
      },
    });
  }
  await prisma.user.create({
    data: { id: USER_ID, email: `${suffix}@acme.test`, name: "ACME Admin" },
  });
  await prisma.virtualKey.create({
    data: {
      id: TEAM_VK,
      organizationId: ORG_ID,
      name: TEAM_VK,
      hashedSecret: `hash-${TEAM_VK}`,
      displayPrefix: "vk-lw-xxxxxxx",
      principalUserId: USER_ID,
      createdById: USER_ID,
      scopes: { create: [{ scopeType: "PROJECT", scopeId: APP_PROJECT_ID }] },
    },
  });
  await prisma.gatewayBudget.create({
    data: {
      id: TEAM_BUDGET_ID,
      name: TEAM_BUDGET_ID,
      organizationId: ORG_ID,
      scopeType: "TEAM",
      scopeId: TEAM_ID,
      // A MANUAL window carries its own period floor, which sends `check`
      // down the RAW-LEDGER path instead of the pre-aggregated rollup. That
      // is the harder case for this ADR and so the right one to gate on: the
      // materialised-view exclusion does not protect the raw path at all, so
      // here the only thing keeping pulled cost out of an enforcement
      // decision is that `Scope="pulled"` matches no budget. If that were
      // ever wrong, this is where it would show.
      window: "MANUAL",
      currentPeriodStartedAt: new Date(Date.now() - 3_600_000),
      limitUsd: TEAM_LIMIT_USD,
      onBreach: "BLOCK",
      createdById: USER_ID,
      resetsAt: new Date(Date.now() + 86_400_000),
    },
  });

  const resolveClient = async (tenantId: string) => {
    const client = await getClickHouseClientForTenant(tenantId);
    if (!client) throw new Error("no ClickHouse client in test environment");
    return client;
  };
  chRepo = new GatewayBudgetClickHouseRepository(resolveClient);
  service = GatewayService.create(prisma, chRepo);
  eventSourcing = new EventSourcing({
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "all",
  });
  const pipeline = eventSourcing.register(
    PulledUsageEventingAdapter.create({
      ledger: PulledUsageLedgerProcess.create(
        new ClickHousePulledUsageLedgerPort(chRepo),
      ),
    }).build(),
  );
  const commands = mapCommands(pipeline.commands);
  writePulledUsage = (payload) =>
    commands.recordPulledUsage({
      tenantId: payload.tenant_id,
      occurredAt: payload.observed_at_ms,
      data: {
        itemKey: payload.restatement_key,
        restatementKey: payload.restatement_key,
        source: "integration",
        ingestionSourceId: "ingestion-source",
        organizationId: payload.organization_id,
        teamId: payload.team_id,
        projectId: null,
        model: payload.model,
        tokensInput: payload.tokens_input,
        tokensOutput: payload.tokens_output,
        tokensCacheRead: payload.tokens_cache_read,
        tokensCacheWrite: payload.tokens_cache_write,
        costNanoUsd: payload.cost_nano_usd,
        rateVersion: null,
        costBasis: "provider_reported",
        costStatus: "exact",
        occurredAtMs: payload.occurred_at_ms,
        observedAtMs: payload.observed_at_ms,
      },
    } satisfies RecordPulledUsageCommand);
}, 180_000);

afterAll(async () => {
  await eventSourcing?.close();
  await stopTestContainers();
});

describe("given a connected provider source that pulls usage on a schedule", () => {
  describe("when the source pulls a usage record with a known cost", () => {
    /** @scenario "Pulled cost shows in the usage view" */
    it("that cost appears in the customer's usage view", async () => {
      const key = `visible-${suffix}`;
      await writePulledUsage(
        pulledItem({
          restatementKey: key,
          scopeId: TEAM_ID,
          costNanoUsd: 4_250_000_000,
          observedAt: new Date("2026-08-04T09:00:00.000Z"),
        }),
      );

      const totals = await pulledTotalsFor([TEAM_ID]);

      expect(totals.spentNanoUsd).toBe(4_250_000_000);
      expect(totals.spentUsd).toBe("4.25");
      expect(totals.items).toBe(1);
    });
  });

  describe("when the source pulls a usage record", () => {
    /** @scenario "Pulled cost is attributed to the source's team" */
    it("the recorded cost is attributed to that team and its organization", async () => {
      const key = `attributed-${suffix}`;
      await writePulledUsage(
        pulledItem({
          restatementKey: key,
          scopeId: TEAM_ID,
          costNanoUsd: 1_000_000_000,
          observedAt: new Date("2026-08-04T10:00:00.000Z"),
        }),
      );

      const client = await getClickHouseClientForTenant(GOV_PROJECT_ID);
      const result = await client!.query({
        query: `SELECT Scope, ScopeId, BudgetId FROM gateway_budget_ledger_events
                WHERE TenantId = {tenantId:String}
                  AND GatewayRequestId = {requestId:String}
                LIMIT 1`,
        query_params: {
          tenantId: GOV_PROJECT_ID,
          requestId: `${PULLED_USAGE_SCOPE}:${key}`,
        },
        format: "JSONEachRow",
      });
      const [row] = (await result.json()) as Array<{
        Scope: string;
        ScopeId: string;
        BudgetId: string;
      }>;

      expect(row?.ScopeId).toBe(TEAM_ID);
      // The row lands under a scope no budget can hold, so the attribution
      // cannot double as an enforcement target.
      expect(row?.Scope).toBe(PULLED_USAGE_SCOPE);
      expect(row?.BudgetId).toBe(PULLED_USAGE_SCOPE);
    });
  });

  describe("given the source has no team configured", () => {
    /** @scenario "A source with no team is attributed to its organization" */
    it("the cost is attributed to the organization, with no team, and never to an internal governance project", async () => {
      const key = `orgonly-${suffix}`;
      await writePulledUsage(
        pulledItem({
          restatementKey: key,
          // What `pulledUsageScopeId` produces when the source names no team.
          scopeId: ORG_ID,
          teamId: null,
          costNanoUsd: 2_000_000_000,
          observedAt: new Date("2026-08-04T11:00:00.000Z"),
        }),
      );

      const orgTotals = await pulledTotalsFor([ORG_ID]);
      expect(orgTotals.spentNanoUsd).toBe(2_000_000_000);

      // The governance project is where the row is STORED. It must never be
      // what the row is attributed to, or the money is invisible to the
      // customer in the very screens this exists to fill.
      const asGovScope = await pulledTotalsFor([GOV_PROJECT_ID]);
      expect(asGovScope.spentNanoUsd).toBe(0);
      expect(asGovScope.items).toBe(0);
    });
  });

  describe("given a usage period has already been pulled", () => {
    /** @scenario "Re-pulling an unchanged period records nothing new" */
    it("re-pulling the same unchanged period records no additional cost", async () => {
      const key = `unchanged-${suffix}`;
      const item = pulledItem({
        restatementKey: key,
        scopeId: TEAM_ID,
        costNanoUsd: 3_000_000_000,
        observedAt: new Date("2026-08-05T09:00:00.000Z"),
      });
      await writePulledUsage(item);
      const afterFirst = await pulledTotalsFor([TEAM_ID]);

      // A later pull of a window that has not drained re-observes the same
      // bucket. Same money, same quantities, new observation instant.
      await writePulledUsage({
        ...item,
        observed_at_ms: new Date("2026-08-05T10:00:00.000Z").getTime(),
      });
      const afterSecond = await pulledTotalsFor([TEAM_ID]);

      expect(afterSecond.spentNanoUsd).toBe(afterFirst.spentNanoUsd);
      expect(afterSecond.items).toBe(afterFirst.items);
      expect(await rawRowsFor(key)).toBe(1);
    });
  });

  describe("given a usage period was pulled with one cost", () => {
    /** @scenario "A corrected period replaces its earlier cost" */
    it("the reported cost reflects the corrected figure, and the earlier figure is not added on top", async () => {
      const key = `corrected-${suffix}`;
      const before = (await pulledTotalsFor([TEAM_ID])).spentNanoUsd;

      await writePulledUsage(
        pulledItem({
          restatementKey: key,
          scopeId: TEAM_ID,
          costNanoUsd: 10_000_000_000,
          observedAt: new Date("2026-08-06T09:00:00.000Z"),
        }),
      );
      // The provider restates the same bucket. Same coordinates — cost is
      // excluded from the key — so this must REPLACE, not accumulate.
      await writePulledUsage(
        pulledItem({
          restatementKey: key,
          scopeId: TEAM_ID,
          costNanoUsd: 12_000_000_000,
          observedAt: new Date("2026-08-06T10:00:00.000Z"),
        }),
      );

      const after = await pulledTotalsFor([TEAM_ID]);
      expect(after.spentNanoUsd).toBe(before + 12_000_000_000);
      expect(after.spentNanoUsd).not.toBe(before + 22_000_000_000);
    });

    it("a correction back DOWN to an earlier figure is not swallowed", async () => {
      const key = `reverted-${suffix}`;
      const before = (await pulledTotalsFor([TEAM_ID])).spentNanoUsd;

      for (const [cost, at] of [
        [10_000_000_000, "2026-08-07T09:00:00.000Z"],
        [12_000_000_000, "2026-08-07T10:00:00.000Z"],
        [10_000_000_000, "2026-08-07T11:00:00.000Z"],
      ] as const) {
        await writePulledUsage(
          pulledItem({
            restatementKey: key,
            scopeId: TEAM_ID,
            costNanoUsd: cost,
            observedAt: new Date(at),
          }),
        );
      }

      // Money that refuses to go back down is the worst shape this bug takes:
      // the customer is over-reported and nothing ever corrects it.
      const after = await pulledTotalsFor([TEAM_ID]);
      expect(after.spentNanoUsd).toBe(before + 10_000_000_000);
    });
  });

  describe("given a team that is already at its spending limit", () => {
    /** @scenario "Pulled cost never blocks spending" */
    it("records the pulled cost, does not trip the limit with it, and still allows the team's gateway requests", async () => {
      // The team is at $0.99 of a $1 limit through the gateway.
      await writeGatewayDebit(NEARLY_SPENT_NANO);

      // The premise, asserted rather than assumed: the limit is LIVE. A
      // request that would take the team past $1 is refused right now. Without
      // this the rest of the test could pass with no enforcement wired at all,
      // which is the way a gate quietly stops being a gate.
      const overTheLine = await checkTeamRequest("0.50");
      expect(overTheLine.decision).toBe("hard_block");
      expect(overTheLine.blockedBy.map((b) => b.budgetId)).toContain(TEAM_BUDGET_ID);

      const beforePull = await checkTeamRequest("0.001");
      expect(beforePull.decision).not.toBe("hard_block");

      // A pulled cost many times the whole limit, filed against this exact
      // team, in the same window.
      await writePulledUsage(
        pulledItem({
          restatementKey: `gate-${suffix}`,
          scopeId: TEAM_ID,
          costNanoUsd: 50_000_000_000, // $50 against a $1 limit
          observedAt: new Date("2026-08-08T09:00:00.000Z"),
        }),
      );

      // It IS recorded — this is not non-enforcement by not writing.
      const totals = await pulledTotalsFor([TEAM_ID]);
      expect(totals.spentNanoUsd).toBeGreaterThanOrEqual(50_000_000_000);

      // And the request the gateway would have served is still served. The
      // causality that matters: $50 landed against a team with $0.01 left,
      // and the decision did not move.
      const afterPull = await checkTeamRequest("0.001");
      expect(afterPull.decision).toBe(beforePull.decision);
      expect(afterPull.decision).not.toBe("hard_block");
      expect(afterPull.blockedBy).toHaveLength(0);

      // And the aggregate enforcement actually reads holds no pulled row at
      // all. This is the structural half of the gate: even a future read that
      // grouped by scope without naming a budget would find nothing to leak,
      // because migration 00073 keeps the fold from ever admitting these rows.
      const rollup = await rollupRows();
      expect(rollup.some((r) => r.Scope === PULLED_USAGE_SCOPE)).toBe(false);

      // The gateway's own row is present AND its nano aggregate is populated.
      // "No pulled row in the rollup" is trivially true of a rollup that
      // folded nothing at all, so the exclusion is only meaningful next to
      // proof that the view is still doing its job for real budgets.
      const teamRow = rollup.find((r) => r.BudgetId === TEAM_BUDGET_ID);
      expect(teamRow).toBeDefined();
      expect(Number(teamRow?.SpendNanoUSD)).toBe(NEARLY_SPENT_NANO);
    });
  });

  describe("given the same usage is both pulled and seen by the gateway", () => {
    /** @scenario "Pulled and gateway cost for the same usage are not merged" */
    it("the two costs are reported separately, not summed into one total", async () => {
      const gatewayNano = 250_000_000;
      await writeGatewayDebit(gatewayNano);

      const rollup = await rollupRows();
      const gatewayNanoInRollup = rollup
        .filter((r) => r.BudgetId === TEAM_BUDGET_ID)
        .reduce((sum, r) => sum + Number(r.SpendNanoUSD), 0);
      const gatewayUsd = rollup
        .filter((r) => r.BudgetId === TEAM_BUDGET_ID)
        .reduce((sum, r) => sum + Number(r.SpendUSD), 0);
      const pulled = await pulledTotalsFor([TEAM_ID]);

      // The column enforcement actually sums. Asserting only on SpendUSD
      // below would pass with an empty SpendNanoUSD aggregate, which is
      // exactly what "every budget silently stops enforcing" looks like.
      expect(gatewayNanoInRollup).toBe(NEARLY_SPENT_NANO + gatewayNano);

      // Two surfaces, two figures, neither containing the other. There is no
      // request id shared between a provider's bucket and a gateway request,
      // so a combined total would be a number nobody could defend — and the
      // separation is structural: they do not even live in the same read.
      expect(gatewayUsd).toBeCloseTo((NEARLY_SPENT_NANO + gatewayNano) / 1e9, 6);
      expect(pulled.spentNanoUsd).toBeGreaterThan(0);
      // The gateway figure is the gateway's alone: the pulled cost, which is
      // far larger, is nowhere inside it.
      expect(gatewayUsd).toBeLessThan(pulled.spentNanoUsd / 1e9);
    });
  });
});

/**
 * The spend-rollup aggregate as enforcement sees it.
 *
 * `SpendNanoUSD` is the column that matters and the reason this helper exists
 * in this shape. `getSpendForBudgets*` reads `sumMerge(SpendNanoUSD)` and
 * nothing else, so a materialised view that stopped populating it would leave
 * every calendar-window budget reading zero — enforcement silently off — while
 * `SpendUSD`, the Decimal audit column, kept looking perfectly healthy. An
 * earlier version of this test asserted only on `SpendUSD` and was blind to
 * exactly that break in migration 00073. Both are read here; the nano one is
 * what any future test touching this view must assert on.
 */
async function rollupRows(): Promise<
  Array<{
    Scope: string;
    BudgetId: string;
    SpendUSD: string;
    SpendNanoUSD: string;
  }>
> {
  const client = await getClickHouseClientForTenant(APP_PROJECT_ID);
  const result = await client!.query({
    query: `SELECT Scope,
                   BudgetId,
                   toString(sumMerge(SpendUSD))     AS SpendUSD,
                   toString(sumMerge(SpendNanoUSD)) AS SpendNanoUSD
            FROM gateway_budget_scope_totals
            WHERE TenantId IN ({app:String}, {gov:String})
            GROUP BY Scope, BudgetId`,
    query_params: { app: APP_PROJECT_ID, gov: GOV_PROJECT_ID },
    format: "JSONEachRow",
  });
  return (await result.json()) as Array<{
    Scope: string;
    BudgetId: string;
    SpendUSD: string;
    SpendNanoUSD: string;
  }>;
}

/** How many physical rows the ledger holds for one restatement key. */
async function rawRowsFor(restatementKey: string): Promise<number> {
  const client = await getClickHouseClientForTenant(GOV_PROJECT_ID);
  const result = await client!.query({
    query: `SELECT count() AS n FROM gateway_budget_ledger_events
            WHERE TenantId = {tenantId:String} AND GatewayRequestId = {requestId:String}`,
    query_params: {
      tenantId: GOV_PROJECT_ID,
      requestId: `${PULLED_USAGE_SCOPE}:${restatementKey}`,
    },
    format: "JSONEachRow",
  });
  const [row] = (await result.json()) as Array<{ n: string | number }>;
  return Number(row?.n ?? 0);
}
