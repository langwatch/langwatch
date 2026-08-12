/**
 * World for the per-key budget integration suite: the ids, the anchor
 * instant, and the builders that put an organization, its keys, their
 * budgets and their ledger debits into real Postgres + real ClickHouse.
 *
 * Split out of the test so the suite itself stays readable as a list of
 * given/when cases rather than a wall of setup.
 */
import { nanoid } from "nanoid";

import { prisma } from "~/server/db";
import type { GatewayBudgetClickHouseRepository } from "../../budget.clickhouse.repository";
import { usdToNanoUsd } from "../../wireMoney";

const suffix = nanoid(8);

export const ORG_ID = `org-vkb-${suffix}`;
export const TEAM_ID = `team-vkb-${suffix}`;
export const PROJECT_ID = `proj-vkb-${suffix}`;
export const USER_ID = `usr-vkb-${suffix}`;
export const MP_OPENAI_ID = `mp-vkb-openai-${suffix}`;

/** Carries a drawer-managed daily cap. */
export const VK_DAILY_ID = `vk_vkb_daily_${suffix}`;
/** Carries a cap created independently on the Budgets page. */
export const VK_STANDALONE_ID = `vk_vkb_standalone_${suffix}`;
/** Carries both, so the drawer-managed one has something to win against. */
export const VK_BOTH_ID = `vk_vkb_both_${suffix}`;
/** Covered only by the project budget: no cap of its own. */
export const VK_INHERITED_ID = `vk_vkb_inherited_${suffix}`;
/**
 * A neighbouring pair with identical budgets, one used and one not. They
 * exist to prove the bar reads its own bucket: same org, same project,
 * same window, same limit, so a prefix match or a scope-level read would
 * hand the unused one its neighbour's money.
 */
export const VK_NEIGHBOUR_USED_ID = `vk_vkb_neighbour_used_${suffix}`;
export const VK_NEIGHBOUR_UNUSED_ID = `vk_vkb_neighbour_unused_${suffix}`;

export const BUDGET_DAILY_ID = `bdg-vkb-daily-${suffix}`;
export const BUDGET_STANDALONE_ID = `bdg-vkb-standalone-${suffix}`;
export const BUDGET_BOTH_MANAGED_ID = `bdg-vkb-both-managed-${suffix}`;
export const BUDGET_BOTH_STANDALONE_ID = `bdg-vkb-both-standalone-${suffix}`;
export const BUDGET_PROJECT_ID = `bdg-vkb-project-${suffix}`;
export const BUDGET_NEIGHBOUR_USED_ID = `bdg-vkb-neigh-used-${suffix}`;
export const BUDGET_NEIGHBOUR_UNUSED_ID = `bdg-vkb-neigh-unused-${suffix}`;

/**
 * Midday UTC of the current day. Anchoring both the debits and the read
 * to one instant keeps the period arithmetic away from the wall clock: a
 * run at 23:59:59 UTC must not straddle midnight between the write and
 * the read.
 */
export const NOW = (() => {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0),
  );
})();
export const YESTERDAY = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

export const ALL_KEY_IDS = [
  VK_DAILY_ID,
  VK_STANDALONE_ID,
  VK_BOTH_ID,
  VK_INHERITED_ID,
  VK_NEIGHBOUR_USED_ID,
  VK_NEIGHBOUR_UNUSED_ID,
];

/** Keys the fixture never sends a debit for, in any period. */
export const NEVER_USED_KEY_IDS = [VK_INHERITED_ID, VK_NEIGHBOUR_UNUSED_ID];

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
    },
  });
}

async function debit(
  chRepo: GatewayBudgetClickHouseRepository,
  args: {
    budgetId: string;
    scope: "VIRTUAL_KEY" | "PROJECT";
    scopeId: string;
    window: "DAY" | "MONTH";
    virtualKeyId: string;
    amountUsd: string;
    occurredAt: Date;
  },
) {
  await chRepo.insertDebit([
    {
      tenantId: PROJECT_ID,
      budgetId: args.budgetId,
      scope: args.scope,
      scopeId: args.scopeId,
      window: args.window,
      virtualKeyId: args.virtualKeyId,
      gatewayRequestId: `req-${nanoid(10)}`,
      // The cases read in dollars; the ledger is priced in integer
      // nano-USD, and the same boundary conversion the writer uses keeps
      // the seeded money and the asserted money the same money.
      amountNanoUsd: Number(usdToNanoUsd(args.amountUsd)),
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

async function seedTenant() {
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
}

async function seedKeysAndBudgets() {
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
}

async function seedSpend(chRepo: GatewayBudgetClickHouseRepository) {
  // $2.50 landed on the daily-capped key across two days; only today's
  // $0.50 is inside the cap's period.
  await debit(chRepo, {
    budgetId: BUDGET_DAILY_ID,
    scope: "VIRTUAL_KEY",
    scopeId: VK_DAILY_ID,
    window: "DAY",
    virtualKeyId: VK_DAILY_ID,
    amountUsd: "2.0000",
    occurredAt: YESTERDAY,
  });
  await debit(chRepo, {
    budgetId: BUDGET_DAILY_ID,
    scope: "VIRTUAL_KEY",
    scopeId: VK_DAILY_ID,
    window: "DAY",
    virtualKeyId: VK_DAILY_ID,
    amountUsd: "0.5000",
    occurredAt: NOW,
  });
  await debit(chRepo, {
    budgetId: BUDGET_STANDALONE_ID,
    scope: "VIRTUAL_KEY",
    scopeId: VK_STANDALONE_ID,
    window: "MONTH",
    virtualKeyId: VK_STANDALONE_ID,
    amountUsd: "3.0000",
    occurredAt: NOW,
  });
  await debit(chRepo, {
    budgetId: BUDGET_BOTH_MANAGED_ID,
    scope: "VIRTUAL_KEY",
    scopeId: VK_BOTH_ID,
    window: "DAY",
    virtualKeyId: VK_BOTH_ID,
    amountUsd: "0.7500",
    occurredAt: NOW,
  });
  await debit(chRepo, {
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
  await debit(chRepo, {
    budgetId: BUDGET_NEIGHBOUR_USED_ID,
    scope: "VIRTUAL_KEY",
    scopeId: VK_NEIGHBOUR_USED_ID,
    window: "DAY",
    virtualKeyId: VK_NEIGHBOUR_USED_ID,
    amountUsd: "1.2500",
    occurredAt: NOW,
  });
}

export async function seedFixture(chRepo: GatewayBudgetClickHouseRepository) {
  await seedTenant();
  await seedKeysAndBudgets();
  await seedSpend(chRepo);
}

/** Just the slice of the ClickHouse client the teardown needs. */
type CommandRunner = {
  command: (args: {
    query: string;
    query_params?: Record<string, unknown>;
  }) => Promise<unknown>;
};

export async function teardownFixture(clickhouse: CommandRunner | null) {
  if (clickhouse) {
    // The rollup is a materialized-view target, so the source delete does
    // not cascade; both tables need the sweep.
    for (const table of [
      "gateway_budget_ledger_events",
      "gateway_budget_scope_totals",
    ]) {
      await clickhouse.command({
        query: `DELETE FROM ${table} WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: PROJECT_ID },
      });
    }
  }
  await prisma.gatewayBudget.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.modelProvider.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
  await prisma.team.deleteMany({ where: { id: TEAM_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}
