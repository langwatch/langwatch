/**
 * @vitest-environment node
 *
 * The per-key budget the virtual-keys table draws its bar from, against
 * real Postgres + real ClickHouse.
 *
 * The point the bar exists to make is that a key's month total and its
 * budget standing are different measurements: a key that spent $2.50 this
 * month can still be at $0.50 of its $1.00 day. That only holds if the
 * read is bucketed to the budget's own current period, so every spend
 * assertion here writes debits on both sides of a period boundary.
 *
 * Spec: specs/ai-gateway/budgets.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  getTestClickHouseClient,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayBudgetClickHouseRepository } from "../budget.clickhouse.repository";
import { loadDirectBudgetsForKeys } from "../virtualKeyDirectBudget.service";

const suffix = nanoid(8);
const ORG_ID = `org-vkb-${suffix}`;
const TEAM_ID = `team-vkb-${suffix}`;
const PROJECT_ID = `proj-vkb-${suffix}`;
const USER_ID = `usr-vkb-${suffix}`;
const MP_OPENAI_ID = `mp-vkb-openai-${suffix}`;

/** Carries a drawer-managed daily cap. */
const VK_DAILY_ID = `vk_vkb_daily_${suffix}`;
/** Carries a cap created independently on the Budgets page. */
const VK_STANDALONE_ID = `vk_vkb_standalone_${suffix}`;
/** Carries both, so the drawer-managed one has something to win against. */
const VK_BOTH_ID = `vk_vkb_both_${suffix}`;
/** Covered only by the project budget: no cap of its own. */
const VK_INHERITED_ID = `vk_vkb_inherited_${suffix}`;
/**
 * A neighbouring pair with identical budgets, one used and one not. They
 * exist to prove the bar reads its own bucket: same org, same project,
 * same window, same limit, so a prefix match or a scope-level read would
 * hand the unused one its neighbour's money.
 */
const VK_NEIGHBOUR_USED_ID = `vk_vkb_neighbour_used_${suffix}`;
const VK_NEIGHBOUR_UNUSED_ID = `vk_vkb_neighbour_unused_${suffix}`;

const BUDGET_DAILY_ID = `bdg-vkb-daily-${suffix}`;
const BUDGET_STANDALONE_ID = `bdg-vkb-standalone-${suffix}`;
const BUDGET_BOTH_MANAGED_ID = `bdg-vkb-both-managed-${suffix}`;
const BUDGET_BOTH_STANDALONE_ID = `bdg-vkb-both-standalone-${suffix}`;
const BUDGET_PROJECT_ID = `bdg-vkb-project-${suffix}`;
const BUDGET_NEIGHBOUR_USED_ID = `bdg-vkb-neigh-used-${suffix}`;
const BUDGET_NEIGHBOUR_UNUSED_ID = `bdg-vkb-neigh-unused-${suffix}`;

/**
 * Midday UTC of the current day. Anchoring both the debits and the read
 * to one instant keeps the period arithmetic away from the wall clock: a
 * run at 23:59:59 UTC must not straddle midnight between the write and
 * the read.
 */
const NOW = (() => {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0),
  );
})();
const YESTERDAY = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

let chRepo: GatewayBudgetClickHouseRepository;

async function createVirtualKey(id: string, name: string) {
  await prisma.virtualKey.create({
    data: {
      id,
      organizationId: ORG_ID,
      name,
      hashedSecret: `hash-${id}`,
      displayPrefix: `vk-lw-${id.slice(-6)}`,
      createdById: USER_ID,
      scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
    },
  });
}

async function createBudget(args: {
  id: string;
  scopeType: "VIRTUAL_KEY" | "PROJECT";
  scopeId: string;
  window: "DAY" | "MONTH";
  limitUsd: string;
  managedByVirtualKeyId?: string;
  providerKey?: string;
}) {
  await prisma.gatewayBudget.create({
    data: {
      id: args.id,
      name: `Budget ${args.id}`,
      organizationId: ORG_ID,
      scopeType: args.scopeType,
      scopeId: args.scopeId,
      window: args.window,
      limitUsd: args.limitUsd,
      onBreach: "BLOCK",
      createdById: USER_ID,
      resetsAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      ...(args.managedByVirtualKeyId
        ? { managedByVirtualKeyId: args.managedByVirtualKeyId }
        : {}),
      ...(args.providerKey ? { providerKey: args.providerKey } : {}),
    },
  });
}

async function debit(args: {
  budgetId: string;
  scope: "VIRTUAL_KEY" | "PROJECT";
  scopeId: string;
  window: "DAY" | "MONTH";
  virtualKeyId: string;
  amountUsd: string;
  occurredAt: Date;
}) {
  await chRepo.insertDebit([
    {
      tenantId: PROJECT_ID,
      budgetId: args.budgetId,
      scope: args.scope,
      scopeId: args.scopeId,
      window: args.window,
      virtualKeyId: args.virtualKeyId,
      gatewayRequestId: `req-${nanoid(10)}`,
      amountUsd: args.amountUsd,
      tokensInput: 10,
      tokensOutput: 5,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      model: "gpt-5-mini",
      status: "SUCCESS",
      occurredAt: args.occurredAt,
    },
  ]);
}

describe("direct budget per virtual key (real PG + real CH)", () => {
  beforeAll(async () => {
    await startTestContainers();
    chRepo = new GatewayBudgetClickHouseRepository(async () => {
      const client = getTestClickHouseClient();
      if (!client) throw new Error("no test ClickHouse client");
      return client;
    });

    await prisma.organization.create({
      data: { id: ORG_ID, name: `VKB Org ${suffix}`, slug: `vkb-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `VKB Team ${suffix}`,
        slug: `vkb-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `VKB Project ${suffix}`,
        slug: `vkb-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `vkb-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@vkb.local`, name: "Member" },
    });
    await prisma.modelProvider.create({
      data: {
        id: MP_OPENAI_ID,
        name: "openai",
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });

    await createVirtualKey(VK_DAILY_ID, "daily-key");
    await createVirtualKey(VK_STANDALONE_ID, "standalone-key");
    await createVirtualKey(VK_BOTH_ID, "both-key");
    await createVirtualKey(VK_INHERITED_ID, "inherited-key");
    await createVirtualKey(VK_NEIGHBOUR_USED_ID, "neighbour-used");
    await createVirtualKey(VK_NEIGHBOUR_UNUSED_ID, "neighbour-unused");

    await createBudget({
      id: BUDGET_DAILY_ID,
      scopeType: "VIRTUAL_KEY",
      scopeId: VK_DAILY_ID,
      window: "DAY",
      limitUsd: "1.00",
      managedByVirtualKeyId: VK_DAILY_ID,
    });
    await createBudget({
      id: BUDGET_STANDALONE_ID,
      scopeType: "VIRTUAL_KEY",
      scopeId: VK_STANDALONE_ID,
      window: "MONTH",
      limitUsd: "20.00",
    });
    await createBudget({
      id: BUDGET_BOTH_STANDALONE_ID,
      scopeType: "VIRTUAL_KEY",
      scopeId: VK_BOTH_ID,
      window: "MONTH",
      limitUsd: "20.00",
    });
    await createBudget({
      id: BUDGET_BOTH_MANAGED_ID,
      scopeType: "VIRTUAL_KEY",
      scopeId: VK_BOTH_ID,
      window: "DAY",
      limitUsd: "2.00",
      managedByVirtualKeyId: VK_BOTH_ID,
    });
    await createBudget({
      id: BUDGET_PROJECT_ID,
      scopeType: "PROJECT",
      scopeId: PROJECT_ID,
      window: "MONTH",
      limitUsd: "500.00",
    });
    for (const [id, scopeId] of [
      [BUDGET_NEIGHBOUR_USED_ID, VK_NEIGHBOUR_USED_ID],
      [BUDGET_NEIGHBOUR_UNUSED_ID, VK_NEIGHBOUR_UNUSED_ID],
    ] as const) {
      await createBudget({
        id,
        scopeType: "VIRTUAL_KEY",
        scopeId,
        window: "DAY",
        limitUsd: "5.00",
        managedByVirtualKeyId: scopeId,
      });
    }

    // The founder's shape: $2.50 spent on the key this month, $0.50 of it
    // today, against a $1.00 daily cap.
    await debit({
      budgetId: BUDGET_DAILY_ID,
      scope: "VIRTUAL_KEY",
      scopeId: VK_DAILY_ID,
      window: "DAY",
      virtualKeyId: VK_DAILY_ID,
      amountUsd: "2.0000",
      occurredAt: YESTERDAY,
    });
    await debit({
      budgetId: BUDGET_DAILY_ID,
      scope: "VIRTUAL_KEY",
      scopeId: VK_DAILY_ID,
      window: "DAY",
      virtualKeyId: VK_DAILY_ID,
      amountUsd: "0.5000",
      occurredAt: NOW,
    });
    await debit({
      budgetId: BUDGET_STANDALONE_ID,
      scope: "VIRTUAL_KEY",
      scopeId: VK_STANDALONE_ID,
      window: "MONTH",
      virtualKeyId: VK_STANDALONE_ID,
      amountUsd: "3.0000",
      occurredAt: NOW,
    });
    await debit({
      budgetId: BUDGET_BOTH_MANAGED_ID,
      scope: "VIRTUAL_KEY",
      scopeId: VK_BOTH_ID,
      window: "DAY",
      virtualKeyId: VK_BOTH_ID,
      amountUsd: "0.7500",
      occurredAt: NOW,
    });
    await debit({
      budgetId: BUDGET_PROJECT_ID,
      scope: "PROJECT",
      scopeId: PROJECT_ID,
      window: "MONTH",
      virtualKeyId: VK_INHERITED_ID,
      amountUsd: "9.0000",
      occurredAt: NOW,
    });
    // Only the used half of the neighbouring pair ever spends. The unused
    // half is left with a budget and no traffic at all.
    await debit({
      budgetId: BUDGET_NEIGHBOUR_USED_ID,
      scope: "VIRTUAL_KEY",
      scopeId: VK_NEIGHBOUR_USED_ID,
      window: "DAY",
      virtualKeyId: VK_NEIGHBOUR_USED_ID,
      amountUsd: "1.2500",
      occurredAt: NOW,
    });
  }, 120_000);

  afterAll(async () => {
    const ch = getTestClickHouseClient();
    if (ch) {
      await ch.command({
        query:
          "DELETE FROM gateway_budget_ledger_events WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: PROJECT_ID },
      });
      await ch.command({
        query:
          "DELETE FROM gateway_budget_scope_totals WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: PROJECT_ID },
      });
    }
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.modelProvider.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await stopTestContainers();
  }, 120_000);

  const allKeyIds = () => [
    VK_DAILY_ID,
    VK_STANDALONE_ID,
    VK_BOTH_ID,
    VK_INHERITED_ID,
    VK_NEIGHBOUR_USED_ID,
    VK_NEIGHBOUR_UNUSED_ID,
  ];

  /** Keys the fixture never sends a debit for, in any period. */
  const neverUsedKeyIds = () => [VK_INHERITED_ID, VK_NEIGHBOUR_UNUSED_ID];

  const load = () =>
    loadDirectBudgetsForKeys({
      prisma,
      organizationId: ORG_ID,
      virtualKeyIds: allKeyIds(),
      chRepo,
      now: NOW,
    });

  /** @scenario "A key with no budget still reports what it spent" */
  it("reports no direct budget for a key covered only by an inherited one", async () => {
    const budgets = await load();
    expect(budgets.has(VK_INHERITED_ID)).toBe(false);
  });

  /** @scenario "Spend recorded against a budget is visible on that budget" */
  it("reports the daily cap's own period spend, not the month total", async () => {
    const budgets = await load();
    const daily = budgets.get(VK_DAILY_ID);
    expect(daily).toBeDefined();
    expect(daily!.budgetId).toBe(BUDGET_DAILY_ID);
    expect(daily!.window).toBe("DAY");
    expect(Number(daily!.limitUsd)).toBeCloseTo(1, 6);
    // $2.50 landed on this key across the two days; only today's $0.50 is
    // inside the cap's period.
    expect(Number(daily!.periodSpentUsd)).toBeCloseTo(0.5, 6);
  });

  /** @scenario "Monthly budget resets at month start" */
  it("dates the reset at the end of the period the spend was measured over", async () => {
    const budgets = await load();
    const daily = budgets.get(VK_DAILY_ID)!;
    const expected = new Date(
      Date.UTC(
        NOW.getUTCFullYear(),
        NOW.getUTCMonth(),
        NOW.getUTCDate() + 1,
        0,
        0,
        0,
      ),
    );
    expect(daily.resetsAt).toBe(expected.toISOString());

    const monthly = budgets.get(VK_STANDALONE_ID)!;
    const expectedMonth = new Date(
      Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 1, 0, 0, 0),
    );
    expect(monthly.resetsAt).toBe(expectedMonth.toISOString());
  });

  /** @scenario "A budget can target a single virtual key" */
  it("reports a key-targeted budget created outside the key's drawer", async () => {
    const budgets = await load();
    const standalone = budgets.get(VK_STANDALONE_ID);
    expect(standalone?.budgetId).toBe(BUDGET_STANDALONE_ID);
    expect(Number(standalone?.periodSpentUsd)).toBeCloseTo(3, 6);
  });

  /** @scenario "A budget can target a single virtual key" */
  it("prefers the budget the key's own drawer manages when both exist", async () => {
    const budgets = await load();
    const both = budgets.get(VK_BOTH_ID);
    expect(both?.budgetId).toBe(BUDGET_BOTH_MANAGED_ID);
    expect(both?.window).toBe("DAY");
    expect(Number(both?.periodSpentUsd)).toBeCloseTo(0.75, 6);
  });

  /** @scenario "A key covered by several budgets is not counted once per budget" */
  it("reads only its own bucket when a neighbouring key has an identical budget", async () => {
    const budgets = await load();
    const used = budgets.get(VK_NEIGHBOUR_USED_ID);
    const unused = budgets.get(VK_NEIGHBOUR_UNUSED_ID);

    // Both keys exist with the same $5.00/day cap, in the same project.
    expect(used?.budgetId).toBe(BUDGET_NEIGHBOUR_USED_ID);
    expect(unused?.budgetId).toBe(BUDGET_NEIGHBOUR_UNUSED_ID);
    expect(Number(used?.limitUsd)).toBeCloseTo(5, 6);
    expect(Number(unused?.limitUsd)).toBeCloseTo(5, 6);

    // Only one of them spent. A prefix match, or a read at the project's
    // scope rather than the key's bucket, would give the other one this
    // money too.
    expect(Number(used?.periodSpentUsd)).toBeCloseTo(1.25, 6);
    expect(unused?.periodSpentUsd).toBe("0.000000");
  });

  /**
   * The incoherence the founder caught in QA: a key that has never served
   * a request cannot have spent anything, so a bar above zero on such a
   * key is a bug in the read, not a display quirk. Pinned as a failure
   * condition rather than left to a screenshot to catch.
   *
   * @scenario "A key with no budget still reports what it spent"
   */
  it("never reports spend on a key that has never been used", async () => {
    const budgets = await load();
    for (const keyId of neverUsedKeyIds()) {
      const row = budgets.get(keyId);
      if (!row) continue; // no direct budget: no bar to be wrong about
      expect(
        Number(row.periodSpentUsd),
        `key ${keyId} has never been used but its budget bar reads ${row.periodSpentUsd}`,
      ).toBe(0);
    }
  });

  /** @scenario "A budget whose spend cannot be totalled says so instead of showing zero" */
  it("reports an unknown spend rather than zero when the rollup cannot be read", async () => {
    const budgets = await loadDirectBudgetsForKeys({
      prisma,
      organizationId: ORG_ID,
      virtualKeyIds: allKeyIds(),
      chRepo: undefined,
      now: NOW,
    });
    const daily = budgets.get(VK_DAILY_ID);
    expect(daily?.budgetId).toBe(BUDGET_DAILY_ID);
    expect(daily?.periodSpentUsd).toBeNull();
  });

  /** @scenario "A budget can target a single virtual key" */
  it("leaves an archived cap off the key that used to carry it", async () => {
    await prisma.gatewayBudget.update({
      where: { id: BUDGET_STANDALONE_ID },
      data: { archivedAt: new Date() },
    });
    try {
      const budgets = await load();
      expect(budgets.has(VK_STANDALONE_ID)).toBe(false);
    } finally {
      await prisma.gatewayBudget.update({
        where: { id: BUDGET_STANDALONE_ID },
        data: { archivedAt: null },
      });
    }
  });
});
