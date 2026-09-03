/**
 * @vitest-environment node
 *
 * The per-key budget the virtual-keys table draws its bar from, against
 * real Postgres + real ClickHouse.
 *
 * The point the bar exists to make is that a key's month total and its
 * budget standing are different measurements: a key that spent $2.50 this
 * month can still be at $0.50 of its $1.00 day. That only holds if the
 * read is bucketed to the budget's own current period, so the fixture
 * writes debits on both sides of a period boundary.
 *
 * World and builders live in `support/virtual-key-direct-budget.fixture`.
 *
 * Spec: specs/ai-gateway/budgets.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { GatewayBudgetClickHouseRepository } from "../../repositories/clickhouse/clickhouse.gateway-budget.repository";
import { loadDirectBudgetsForKeys } from "../virtual-key-direct-budget.service";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support";
import {
  ALL_KEY_IDS,
  BUDGET_BOTH_MANAGED_ID,
  BUDGET_DAILY_ID,
  BUDGET_NEIGHBOUR_UNUSED_ID,
  BUDGET_NEIGHBOUR_USED_ID,
  BUDGET_STANDALONE_ID,
  NEVER_USED_KEY_IDS,
  NOW,
  ORG_ID,
  seedFixture,
  teardownFixture,
  VK_BOTH_ID,
  VK_DAILY_ID,
  VK_INHERITED_ID,
  VK_NEIGHBOUR_UNUSED_ID,
  VK_NEIGHBOUR_USED_ID,
  VK_STANDALONE_ID,
} from "./support/virtual-key-direct-budget.fixture";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const chUrl = testClickHouseUrl();
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

let chRepo: GatewayBudgetClickHouseRepository;

const load = () =>
  loadDirectBudgetsForKeys({
    prisma,
    organizationId: ORG_ID,
    virtualKeyIds: ALL_KEY_IDS,
    chRepo,
    now: NOW,
  });

describe.skipIf(!databaseUrl || !chUrl)(
  "direct budget per virtual key (real PG + real CH)",
  () => {
    beforeAll(async () => {
      chRepo = new GatewayBudgetClickHouseRepository(async () =>
        createTestClickHouseClient(chUrl!),
      );
      await seedFixture(prisma, chRepo);
    }, 120_000);

    afterAll(async () => {
      await teardownFixture(prisma, createTestClickHouseClient(chUrl!));
    }, 120_000);

    describe("given a key with a drawer-managed daily cap", () => {
      /** @scenario "Spend recorded against a budget is visible on that budget" */
      it("reports the cap's own period spend, not the month total", async () => {
        const daily = (await load()).get(VK_DAILY_ID);
        expect(daily).toBeDefined();
        expect(daily?.budgetId).toBe(BUDGET_DAILY_ID);
        expect(daily?.window).toBe("DAY");
        expect(Number(daily?.limitUsd)).toBeCloseTo(1, 6);
        // $2.50 landed on this key across the two days; only today's $0.50
        // is inside the cap's period.
        expect(Number(daily?.periodSpentUsd)).toBeCloseTo(0.5, 6);
      });

      /** @scenario "Monthly budget resets at month start" */
      it("dates the reset at the end of the period the spend was measured over", async () => {
        const budgets = await load();
        const expectedDay = new Date(
          Date.UTC(
            NOW.getUTCFullYear(),
            NOW.getUTCMonth(),
            NOW.getUTCDate() + 1,
            0,
            0,
            0,
          ),
        );
        expect(budgets.get(VK_DAILY_ID)?.resetsAt).toBe(
          expectedDay.toISOString(),
        );

        const expectedMonth = new Date(
          Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 1, 0, 0, 0),
        );
        expect(budgets.get(VK_STANDALONE_ID)?.resetsAt).toBe(
          expectedMonth.toISOString(),
        );
      });
    });

    describe("given a key capped from the Budgets page rather than its drawer", () => {
      /** @scenario "A budget can target a single virtual key" */
      it("reports that budget all the same", async () => {
        const standalone = (await load()).get(VK_STANDALONE_ID);
        expect(standalone?.budgetId).toBe(BUDGET_STANDALONE_ID);
        expect(Number(standalone?.periodSpentUsd)).toBeCloseTo(3, 6);
      });

      /** @scenario "A budget can target a single virtual key" */
      it("drops the cap once it is archived", async () => {
        await prisma.gatewayBudget.update({
          where: { id: BUDGET_STANDALONE_ID },
          data: { archivedAt: new Date() },
        });
        try {
          expect((await load()).has(VK_STANDALONE_ID)).toBe(false);
        } finally {
          await prisma.gatewayBudget.update({
            where: { id: BUDGET_STANDALONE_ID },
            data: { archivedAt: null },
          });
        }
      });
    });

    describe("given a key with both a managed and a standalone cap", () => {
      /** @scenario "A budget can target a single virtual key" */
      it("prefers the budget the key's own drawer manages", async () => {
        const both = (await load()).get(VK_BOTH_ID);
        expect(both?.budgetId).toBe(BUDGET_BOTH_MANAGED_ID);
        expect(both?.window).toBe("DAY");
        expect(Number(both?.periodSpentUsd)).toBeCloseTo(0.75, 6);
      });
    });

    describe("given two keys with identical budgets and only one of them used", () => {
      /** @scenario "A key covered by several budgets is not counted once per budget" */
      it("reads only its own bucket", async () => {
        const budgets = await load();
        const used = budgets.get(VK_NEIGHBOUR_USED_ID);
        const unused = budgets.get(VK_NEIGHBOUR_UNUSED_ID);

        expect(used?.budgetId).toBe(BUDGET_NEIGHBOUR_USED_ID);
        expect(unused?.budgetId).toBe(BUDGET_NEIGHBOUR_UNUSED_ID);
        expect(Number(used?.limitUsd)).toBeCloseTo(5, 6);
        expect(Number(unused?.limitUsd)).toBeCloseTo(5, 6);

        // A prefix match, or a read at the project's scope rather than the
        // key's bucket, would give the unused one this money too.
        expect(Number(used?.periodSpentUsd)).toBeCloseTo(1.25, 6);
        // A confident zero, not the null an unreadable rollup reports. The
        // digits it is written with belong to the money layer, so what is
        // pinned here is the value and the fact that it was read at all.
        expect(unused?.periodSpentUsd).not.toBeNull();
        expect(Number(unused?.periodSpentUsd)).toBe(0);
      });
    });

    describe("given a key that has never served a request", () => {
      /** @scenario "A key with no budget still reports what it spent" */
      it("has no direct budget when only an inherited one covers it", async () => {
        expect((await load()).has(VK_INHERITED_ID)).toBe(false);
      });

      // The incoherence caught in QA: a key that has never served a request
      // cannot have spent anything, so a bar above zero on such a key is a
      // bug in the read, not a display quirk. Pinned as a failure condition
      // rather than left to a screenshot to catch.
      /** @scenario "A key with no budget still reports what it spent" */
      it("never reports spend on its own budget", async () => {
        const budgets = await load();
        const rows = NEVER_USED_KEY_IDS.flatMap((keyId) => {
          const row = budgets.get(keyId);
          return row ? [{ keyId, row }] : [];
        });

        // Without this the loop below is vacuous: a regression that dropped
        // every direct budget would leave nothing to assert and pass. The
        // unused neighbour carries its own VIRTUAL_KEY budget, so at least
        // one row has to be here.
        expect(rows.length).toBeGreaterThan(0);

        for (const { keyId, row } of rows) {
          expect(
            Number(row.periodSpentUsd),
            `key ${keyId} has never been used but its budget bar reads ${row.periodSpentUsd}`,
          ).toBe(0);
        }
      });
    });

    describe("when the rollup cannot be read", () => {
      /** @scenario "A budget whose spend cannot be totalled says so instead of showing zero" */
      it("reports an unknown spend rather than zero", async () => {
        const budgets = await loadDirectBudgetsForKeys({
          prisma,
          organizationId: ORG_ID,
          virtualKeyIds: ALL_KEY_IDS,
          chRepo: undefined,
          now: NOW,
        });
        const daily = budgets.get(VK_DAILY_ID);
        expect(daily?.budgetId).toBe(BUDGET_DAILY_ID);
        expect(daily?.periodSpentUsd).toBeNull();
      });
    });
  },
);
