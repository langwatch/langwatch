/** @vitest-environment node */

/**
 * Pulled provider cost is visible, attributed, correct under restatement, and
 * cannot block a request: real Postgres and ClickHouse, and the enforcement
 * half read through the gateway's own `check`. ADR-088.
 */
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-client";
import {
  GatewayBudgetLedgerAdapter,
  PrismaGatewayAdapter,
  TestProjectService,
  type GatewayBudgetSpendPort,
  type GatewayService,
} from "@langwatch/gateway-server/testing";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { migrateTestClickHouseOnce, startTestClickHouseEndpoints } from "@langwatch/test-harness";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PulledUsageLedgerIntent,
  type WritePulledUsagePayload,
} from "../intents/pulled-usage-ledger.intent";
import {
  PulledUsageLedgerPort,
  type PulledUsageLedgerRow,
} from "../ports/pulled-usage-ledger.port";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const suffix = nanoid(8);
const ORG_ID = `org-pulled-${suffix}`;
const TEAM_ID = `team-pulled-${suffix}`;
/** The organization's hidden governance project: the storage tenant, never the owner. */
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

let budgets: GatewayBudgetSpendPort;
let gateway: GatewayService;
let writePulledUsage: (payload: WritePulledUsagePayload) => Promise<void>;
let clickhouse: ClickHouseClient;

/** The ledger as the composition wires it: the intent's port over the
 *  gateway's ClickHouse repository. */
class LedgerOverGatewayBudgets extends PulledUsageLedgerPort {
  constructor(private readonly repository: GatewayBudgetSpendPort) {
    super();
  }

  insert(rows: PulledUsageLedgerRow[]): Promise<void> {
    return this.repository.insertPulledUsageRows(rows);
  }
}

/** The two project reads the decision path makes, answered from this suite's rows. */
class SuiteProjectService extends TestProjectService {
  override async listIdsByOrganization(): ReturnType<ProjectService["listIdsByOrganization"]> {
    return [APP_PROJECT_ID, GOV_PROJECT_ID];
  }

  override async listTraceDestinations(
    projectIds: string[],
  ): ReturnType<ProjectService["listTraceDestinations"]> {
    return await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, teamId: true, apiKey: true, archivedAt: true },
    });
  }
}

/** One pulled usage item, as the process manager mints it. */
function pulledItem(options: {
  restatementKey: string;
  scopeId: string;
  costNanoUsd: number;
  teamId?: string | null;
  observedAt: Date;
}): WritePulledUsagePayload {
  return {
    restatement_key: options.restatementKey,
    tenant_id: GOV_PROJECT_ID,
    scope_id: options.scopeId,
    organization_id: ORG_ID,
    team_id: options.teamId === undefined ? TEAM_ID : options.teamId,
    model: "anthropic/claude-sonnet-5",
    cost_nano_usd: options.costNanoUsd,
    tokens_input: 1_000,
    tokens_output: 200,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    occurred_at_ms: BUCKET_AT.getTime(),
    observed_at_ms: options.observedAt.getTime(),
  };
}

/** What the dedicated pulled read reports for a scope over the window. */
function pulledTotalsFor(scopeIds: string[]) {
  return budgets.readPulledUsageTotals({
    tenantId: GOV_PROJECT_ID,
    scopeIds,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });
}

/** A gateway debit for the same team, written the way the spend spine does. */
async function writeGatewayDebit(costNanoUsd: number): Promise<void> {
  const budget = await prisma.gatewayBudget.findUniqueOrThrow({ where: { id: TEAM_BUDGET_ID } });
  await budgets.insertDebitsForBudgets([
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
  return gateway.check({
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    projectId: APP_PROJECT_ID,
    virtualKeyId: TEAM_VK,
    principalUserId: USER_ID,
    projectedCostUsd,
  });
}

/** The spend rollup as enforcement reads it. `SpendNanoUSD` is the column that
 *  matters: a view that stopped populating it would leave every calendar-window
 *  budget reading zero while the Decimal audit column still looked healthy. */
async function rollupRows(): Promise<
  Array<{ Scope: string; BudgetId: string; SpendUSD: string; SpendNanoUSD: string }>
> {
  const result = await clickhouse.query({
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
  return await result.json();
}

let clickHouseUrl: string | null = null;

describe.skipIf(!databaseUrl)(
  "given a connected provider source that pulls usage on a schedule",
  () => {
    beforeAll(async () => {
      const [endpoint] = await startTestClickHouseEndpoints({
        suite: "governance-pulled-usage",
        names: ["ledger"],
      });
      if (!endpoint)
        throw new Error("No ClickHouse endpoint was provisioned for the pulled-usage suite");
      clickHouseUrl = endpoint.url;

      await migrateTestClickHouseOnce({
        url: endpoint.url,
        migrate: async () => {
          // CLICKHOUSE_CLUSTER switches every engine to its Replicated form,
          // which needs a Keeper no test server has.
          const previousCluster = process.env.CLICKHOUSE_CLUSTER;
          delete process.env.CLICKHOUSE_CLUSTER;
          try {
            await ClickHouseMigrateTask.createFromConfig({
              config: {
                buildTime: false,
                skipped: false,
                sharedUrl: endpoint.url,
                privateEndpoints: [],
              },
            }).execute();
          } finally {
            if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
          }
        },
      });

      clickhouse = createClient({
        url: endpoint.url,
        clickhouse_settings: { date_time_input_format: "best_effort" },
      });

      await prisma.organization.create({
        data: { id: ORG_ID, name: `Org ${suffix}`, slug: ORG_ID },
      });
      await prisma.team.create({
        data: { id: TEAM_ID, name: `Team ${suffix}`, slug: TEAM_ID, organizationId: ORG_ID },
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
          traceProjectId: APP_PROJECT_ID,
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
          // down the RAW-LEDGER path rather than the pre-aggregated rollup --
          // the harder case, where the only thing keeping pulled cost out of an
          // enforcement decision is that its scope matches no budget.
          window: "MANUAL",
          currentPeriodStartedAt: new Date(Date.now() - 3_600_000),
          limitUsd: TEAM_LIMIT_USD,
          onBreach: "BLOCK",
          createdById: USER_ID,
          resetsAt: new Date(Date.now() + 86_400_000),
        },
      });

      budgets = GatewayBudgetLedgerAdapter.create(async () => clickhouse as never);
      gateway = PrismaGatewayAdapter.create({
        database: prisma,
        projects: new SuiteProjectService(),
        evaluators: {} as never,
        monitors: {} as never,
        changes: {} as never,
        audit: {} as never,
        budgetSpend: budgets,
      }).build();
      writePulledUsage = (payload) =>
        PulledUsageLedgerIntent.create(new LedgerOverGatewayBudgets(budgets)).execute(payload);
    }, 600_000);

    afterAll(async () => {
      if (clickHouseUrl) {
        for (const table of ["gateway_budget_ledger_events", "gateway_budget_scope_totals"]) {
          await clickhouse.command({
            query: `DELETE FROM ${table} WHERE TenantId IN ({app:String}, {gov:String})`,
            query_params: { app: APP_PROJECT_ID, gov: GOV_PROJECT_ID },
          });
        }
        await clickhouse.close();
      }
      await prisma.gatewayBudget.deleteMany({ where: { organizationId: ORG_ID } });
      await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
      await prisma.user.deleteMany({ where: { id: USER_ID } });
      await prisma.project.deleteMany({ where: { id: { in: [GOV_PROJECT_ID, APP_PROJECT_ID] } } });
      await prisma.team.deleteMany({ where: { id: TEAM_ID } });
      await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    }, 120_000);

    describe("when the source pulls a usage record with a known cost", () => {
      /** @scenario "Pulled cost shows in the usage view" */
      it("shows that cost in the customer's usage view", async () => {
        await writePulledUsage(
          pulledItem({
            restatementKey: `visible-${suffix}`,
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

      /** @scenario "Pulled cost is attributed to the source's team" */
      it("attributes the recorded cost to that team, under a scope no budget can hold", async () => {
        const key = `attributed-${suffix}`;
        await writePulledUsage(
          pulledItem({
            restatementKey: key,
            scopeId: TEAM_ID,
            costNanoUsd: 1_000_000_000,
            observedAt: new Date("2026-08-04T10:00:00.000Z"),
          }),
        );

        const result = await clickhouse.query({
          query: `SELECT Scope, ScopeId FROM gateway_budget_ledger_events
                WHERE TenantId = {tenantId:String} AND GatewayRequestId LIKE {request:String}
                LIMIT 1`,
          query_params: { tenantId: GOV_PROJECT_ID, request: `%:${key}` },
          format: "JSONEachRow",
        });
        const [row] = await result.json<{ Scope: string; ScopeId: string }>();

        expect(row?.ScopeId).toBe(TEAM_ID);
        // The row lands under a scope no budget can hold, so the attribution
        // cannot double as an enforcement target: the rollup enforcement reads
        // carries nothing under it.
        const rollup = await rollupRows();
        expect(rollup.some((entry) => entry.Scope === row?.Scope)).toBe(false);
      });
    });

    describe("given the source has no team configured", () => {
      /** @scenario "A source with no team is attributed to its organization" */
      it("attributes the cost to the organization, never to the internal governance project", async () => {
        await writePulledUsage(
          pulledItem({
            restatementKey: `orgonly-${suffix}`,
            scopeId: ORG_ID,
            teamId: null,
            costNanoUsd: 2_000_000_000,
            observedAt: new Date("2026-08-04T11:00:00.000Z"),
          }),
        );

        expect((await pulledTotalsFor([ORG_ID])).spentNanoUsd).toBe(2_000_000_000);

        // The governance project is where the row is STORED. It must never be
        // what the row is attributed to, or the money is invisible in the very
        // screens this exists to fill.
        const asGovScope = await pulledTotalsFor([GOV_PROJECT_ID]);
        expect(asGovScope.spentNanoUsd).toBe(0);
        expect(asGovScope.items).toBe(0);
      });
    });

    describe("given a usage period has already been pulled", () => {
      /** @scenario "Re-pulling an unchanged period records nothing new" */
      it("records no additional cost when the same unchanged period is pulled again", async () => {
        const item = pulledItem({
          restatementKey: `unchanged-${suffix}`,
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
      });
    });

    describe("given a usage period was pulled with one cost", () => {
      /** @scenario "A corrected period replaces its earlier cost" */
      it("reports the corrected figure without adding the earlier one on top", async () => {
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
        // The provider restates the same bucket. Same coordinates -- cost is
        // excluded from the key -- so this must REPLACE, not accumulate.
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
      });

      it("does not swallow a correction back down to an earlier figure", async () => {
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
        expect((await pulledTotalsFor([TEAM_ID])).spentNanoUsd).toBe(before + 10_000_000_000);
      });
    });

    describe("given a team whose spending is already at its limit", () => {
      /** @scenario "Pulled cost never blocks spending" */
      it("records the pulled cost, does not trip the limit with it, and still allows the team's requests", async () => {
        // The team is at $0.99 of a $1 limit through the gateway.
        await writeGatewayDebit(NEARLY_SPENT_NANO);

        // The premise, asserted rather than assumed: the limit is LIVE. Without
        // this the rest could pass with no enforcement wired at all, which is
        // how a gate quietly stops being a gate.
        const overTheLine = await checkTeamRequest("0.50");
        expect(overTheLine.decision).toBe("hard_block");
        expect(overTheLine.blockedBy.map((blocked) => blocked.budgetId)).toContain(TEAM_BUDGET_ID);

        const beforePull = await checkTeamRequest("0.001");
        expect(beforePull.decision).not.toBe("hard_block");

        // A pulled cost many times the whole limit, filed against this exact
        // team, in the same window.
        await writePulledUsage(
          pulledItem({
            restatementKey: `gate-${suffix}`,
            scopeId: TEAM_ID,
            costNanoUsd: 50_000_000_000,
            observedAt: new Date("2026-08-08T09:00:00.000Z"),
          }),
        );

        // It IS recorded -- this is not non-enforcement by not writing.
        expect((await pulledTotalsFor([TEAM_ID])).spentNanoUsd).toBeGreaterThanOrEqual(
          50_000_000_000,
        );

        const afterPull = await checkTeamRequest("0.001");
        expect(afterPull.decision).toBe(beforePull.decision);
        expect(afterPull.blockedBy).toHaveLength(0);

        // The aggregate enforcement reads carries only the real budget, and
        // that budget's own row is populated next to it -- "no pulled row" is
        // trivially true of a rollup that folded nothing.
        const rollup = await rollupRows();
        expect(rollup.every((row) => row.BudgetId === TEAM_BUDGET_ID)).toBe(true);
        const teamRow = rollup.find((row) => row.BudgetId === TEAM_BUDGET_ID);
        expect(Number(teamRow?.SpendNanoUSD)).toBe(NEARLY_SPENT_NANO);
      });
    });

    describe("given the same usage is both pulled and seen by the gateway", () => {
      /** @scenario "Pulled and gateway cost for the same usage are not merged" */
      it("reports the two costs separately, neither summed into the other", async () => {
        const gatewayNano = 250_000_000;
        await writeGatewayDebit(gatewayNano);

        const rollup = await rollupRows();
        const gatewayNanoInRollup = rollup
          .filter((row) => row.BudgetId === TEAM_BUDGET_ID)
          .reduce((sum, row) => sum + Number(row.SpendNanoUSD), 0);
        const pulled = await pulledTotalsFor([TEAM_ID]);

        // The column enforcement actually sums.
        expect(gatewayNanoInRollup).toBe(NEARLY_SPENT_NANO + gatewayNano);
        // Two surfaces, two figures, neither containing the other: there is no
        // request id shared between a provider's bucket and a gateway request.
        expect(pulled.spentNanoUsd).toBeGreaterThan(0);
        expect(gatewayNanoInRollup).toBeLessThan(pulled.spentNanoUsd);
      });
    });
  },
);
