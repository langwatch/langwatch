/**
 * The world every budget-overview assertion reads against: one
 * organization with a work project, a retired one, the member's personal
 * workspace and key, a department they share with a colleague, and five
 * budgets with spend recorded across three project tenants.
 *
 * Lives beside the test rather than inside it so the spec file reads as
 * assertions, and so a second suite can stand up the same world without
 * copying 300 lines of seed.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { usdToNanoUsd } from "@langwatch/gateway-server";
import type { Redis } from "ioredis";
import { nanoid } from "nanoid";

import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import {
  getTestClickHouseClient,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayBudgetClickHouseRepository } from "../../budget.clickhouse.repository";
import { BudgetOverviewService } from "../../budgetOverview.service";

export const suffix = nanoid(8);
export const ORG_ID = `org-bov-${suffix}`;
export const TEAM_ID = `team-bov-${suffix}`;
export const WORK_PROJECT_ID = `proj-bov-work-${suffix}`;
export const ARCHIVED_PROJECT_ID = `proj-bov-archived-${suffix}`;
export const PERSONAL_TEAM_ID = `pteam-bov-${suffix}`;
export const PERSONAL_PROJECT_ID = `proj-bov-personal-${suffix}`;
export const USER_ID = `usr-bov-${suffix}`;
export const OTHER_USER_ID = `usr-bov-other-${suffix}`;
export const OUTSIDER_USER_ID = `usr-bov-outsider-${suffix}`;
export const GROUP_ID = `grp-bov-${suffix}`;
export const MP_OPENAI_ID = `mp-bov-openai-${suffix}`;
export const VK_PERSONAL_ID = `vk_bov_personal_${suffix}`;
export const BUDGET_ORG_ID = `bdg-bov-org-${suffix}`;
export const BUDGET_PRINCIPAL_ID = `bdg-bov-principal-${suffix}`;
export const BUDGET_PROVIDER_ID = `bdg-bov-provider-${suffix}`;
export const BUDGET_GROUP_ID = `bdg-bov-group-${suffix}`;
export const BUDGET_ARCHIVED_ID = `bdg-bov-archived-${suffix}`;
export const ACCESS_TOKEN = `lw_at_bov-${suffix}`;

const TENANTS = [WORK_PROJECT_ID, PERSONAL_PROJECT_ID, ARCHIVED_PROJECT_ID];

// The test container's Redis, captured from startTestContainers so the seed
// and teardown share the connection the app routes read through.
let redisConnection: Redis | null = null;

export function chRepo(): GatewayBudgetClickHouseRepository {
  const ch = getTestClickHouseClient();
  return new GatewayBudgetClickHouseRepository(async () => ch as ClickHouseClient);
}

export function overviewService(): BudgetOverviewService {
  return BudgetOverviewService.create(prisma, chRepo());
}

async function seedDebit(input: {
  tenantId: string;
  budgetId: string;
  scope: "ORGANIZATION" | "PRINCIPAL" | "GROUP";
  bucketScopeId: string;
  window: "MONTH" | "WEEK" | "DAY";
  amountUsd: string;
  requestId: string;
}) {
  await chRepo().insertDebit([
    {
      tenantId: input.tenantId,
      budgetId: input.budgetId,
      scope: input.scope,
      scopeId: input.bucketScopeId,
      window: input.window,
      virtualKeyId: VK_PERSONAL_ID,
      gatewayRequestId: input.requestId,
      amountNanoUsd: Number(usdToNanoUsd(input.amountUsd)),
      tokensInput: 10,
      tokensOutput: 5,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      model: "gpt-5-mini",
      status: "SUCCESS",
      occurredAt: new Date(),
    },
  ]);
}

/** Stand the world up. Bracketed by `startTestContainers`. */
export async function seedBudgetOverviewFixture(): Promise<void> {
  ({ redisConnection } = await startTestContainers());

  // The tRPC user.budgetOverview procedure, the CLI REST endpoint and
  // gatewayBudgets.get all read getApp().gatewayStores.budgets, so stand up a test
  // App whose budget repo points at the same test ClickHouse the debits below
  // are seeded into. Without it those surfaces read an empty ledger and
  // disagree with the direct-service reads.
  await resetApp();
  const app = createTestApp({ redis: redisConnection });
  app.gatewayStores.budgets = chRepo();
  globalForApp.__langwatch_app = app;

  await prisma.organization.create({
    data: { id: ORG_ID, name: `ACME ${suffix}`, slug: `bov-${suffix}` },
  });
  await prisma.user.create({
    data: { id: USER_ID, email: `bov-${suffix}@acme.test`, name: "Member" },
  });
  await prisma.user.create({
    data: {
      id: OTHER_USER_ID,
      email: `bov-other-${suffix}@acme.test`,
      name: "Colleague",
    },
  });
  await prisma.user.create({
    data: {
      id: OUTSIDER_USER_ID,
      email: `bov-outsider-${suffix}@acme.test`,
      name: "Outsider",
    },
  });
  // ADMIN so the same caller can also read gatewayBudgets.get in the
  // differential test; role does not change what budgets bind them.
  await prisma.organizationUser.create({
    data: { organizationId: ORG_ID, userId: USER_ID, role: "ADMIN" },
  });
  await prisma.organizationUser.create({
    data: { organizationId: ORG_ID, userId: OTHER_USER_ID, role: "MEMBER" },
  });

  await prisma.team.create({
    data: {
      id: TEAM_ID,
      name: `Core ${suffix}`,
      slug: `bov-core-${suffix}`,
      organizationId: ORG_ID,
    },
  });
  await prisma.project.create({
    data: {
      id: WORK_PROJECT_ID,
      name: `Work ${suffix}`,
      slug: `bov-work-${suffix}`,
      teamId: TEAM_ID,
      language: "en",
      framework: "openai",
      apiKey: `bov-work-key-${suffix}`,
    },
  });
  // An archived project still holds the ledger rows it wrote while it
  // was live, and the gateway still counts them, so every read-side
  // surface has to as well.
  await prisma.project.create({
    data: {
      id: ARCHIVED_PROJECT_ID,
      name: `Retired ${suffix}`,
      slug: `bov-archived-${suffix}`,
      teamId: TEAM_ID,
      language: "en",
      framework: "openai",
      apiKey: `bov-archived-key-${suffix}`,
      archivedAt: new Date(),
    },
  });
  // Admin power flows through team/role bindings, not OrgUser.role:
  // a TeamUser ADMIN row on the (non-personal) team is what lets the
  // differential caller read gatewayBudgets.get.
  await prisma.teamUser.create({
    data: { teamId: TEAM_ID, userId: USER_ID, role: "ADMIN" },
  });

  // Personal workspace, the same shape PersonalWorkspaceService.ensure
  // creates: personal team + personal project owned by the user.
  await prisma.team.create({
    data: {
      id: PERSONAL_TEAM_ID,
      name: `Member's Workspace ${suffix}`,
      slug: `bov-pteam-${suffix}`,
      organizationId: ORG_ID,
      isPersonal: true,
      ownerUserId: USER_ID,
    },
  });
  await prisma.project.create({
    data: {
      id: PERSONAL_PROJECT_ID,
      name: `Member's Project ${suffix}`,
      slug: `bov-pproj-${suffix}`,
      teamId: PERSONAL_TEAM_ID,
      language: "en",
      framework: "openai",
      apiKey: `bov-personal-key-${suffix}`,
      isPersonal: true,
      ownerUserId: USER_ID,
    },
  });
  await prisma.virtualKey.create({
    data: {
      id: VK_PERSONAL_ID,
      organizationId: ORG_ID,
      name: "member-personal-key",
      hashedSecret: `hash-bov-${suffix}`,
      displayPrefix: "vk-lw-bov",
      principalUserId: USER_ID,
      createdById: USER_ID,
      scopes: {
        create: [{ scopeType: "PROJECT", scopeId: PERSONAL_PROJECT_ID }],
      },
    },
  });

  await prisma.group.create({
    data: {
      id: GROUP_ID,
      organizationId: ORG_ID,
      name: `Engineering ${suffix}`,
      slug: `bov-eng-${suffix}`,
      members: {
        create: [{ userId: USER_ID }, { userId: OTHER_USER_ID }],
      },
    },
  });
  await prisma.modelProvider.create({
    data: {
      id: MP_OPENAI_ID,
      name: "OpenAI",
      provider: "openai",
      enabled: true,
      organizationId: ORG_ID,
      scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
    },
  });

  const resetsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.gatewayBudget.create({
    data: {
      id: BUDGET_ORG_ID,
      name: `Org monthly ${suffix}`,
      organizationId: ORG_ID,
      scopeType: "ORGANIZATION",
      scopeId: ORG_ID,
      window: "MONTH",
      limitUsd: "100.00",
      onBreach: "BLOCK",
      createdById: USER_ID,
      resetsAt,
    },
  });
  await prisma.gatewayBudget.create({
    data: {
      id: BUDGET_PRINCIPAL_ID,
      name: `Member cap ${suffix}`,
      organizationId: ORG_ID,
      scopeType: "PRINCIPAL",
      scopeId: USER_ID,
      window: "MONTH",
      limitUsd: "25.00",
      onBreach: "BLOCK",
      createdById: USER_ID,
      resetsAt,
    },
  });
  await prisma.gatewayBudget.create({
    data: {
      id: BUDGET_PROVIDER_ID,
      name: `Org OpenAI only ${suffix}`,
      organizationId: ORG_ID,
      scopeType: "ORGANIZATION",
      scopeId: ORG_ID,
      providerKey: MP_OPENAI_ID,
      window: "MONTH",
      limitUsd: "40.00",
      onBreach: "BLOCK",
      createdById: USER_ID,
      resetsAt,
    },
  });
  // Its own window, so it reads a rollup bucket no other budget in this
  // fixture shares and its total is unambiguously the archived debit.
  await prisma.gatewayBudget.create({
    data: {
      id: BUDGET_ARCHIVED_ID,
      name: `Org daily ${suffix}`,
      organizationId: ORG_ID,
      scopeType: "ORGANIZATION",
      scopeId: ORG_ID,
      window: "DAY",
      limitUsd: "20.00",
      onBreach: "BLOCK",
      createdById: USER_ID,
      resetsAt,
    },
  });
  await prisma.gatewayBudget.create({
    data: {
      id: BUDGET_GROUP_ID,
      name: `Engineering per-member ${suffix}`,
      organizationId: ORG_ID,
      scopeType: "GROUP",
      scopeId: GROUP_ID,
      window: "WEEK",
      limitUsd: "50.00",
      onBreach: "BLOCK",
      createdById: USER_ID,
      resetsAt,
    },
  });

  // Spend, written the way the trace-fold reactor writes it. The org
  // budget accrues in TWO different project tenants (the whole point
  // of the fan-out): $1.50 + $0.93 = $2.43.
  await seedDebit({
    tenantId: WORK_PROJECT_ID,
    budgetId: BUDGET_ORG_ID,
    scope: "ORGANIZATION",
    bucketScopeId: ORG_ID,
    window: "MONTH",
    amountUsd: "1.50",
    requestId: `req-bov-org-work-${suffix}`,
  });
  await seedDebit({
    tenantId: PERSONAL_PROJECT_ID,
    budgetId: BUDGET_ORG_ID,
    scope: "ORGANIZATION",
    bucketScopeId: ORG_ID,
    window: "MONTH",
    amountUsd: "0.93",
    requestId: `req-bov-org-personal-${suffix}`,
  });
  await seedDebit({
    tenantId: PERSONAL_PROJECT_ID,
    budgetId: BUDGET_PRINCIPAL_ID,
    scope: "PRINCIPAL",
    bucketScopeId: USER_ID,
    window: "MONTH",
    amountUsd: "0.10",
    requestId: `req-bov-principal-${suffix}`,
  });
  await seedDebit({
    tenantId: ARCHIVED_PROJECT_ID,
    budgetId: BUDGET_ARCHIVED_ID,
    scope: "ORGANIZATION",
    bucketScopeId: ORG_ID,
    window: "DAY",
    amountUsd: "3.30",
    requestId: `req-bov-archived-${suffix}`,
  });
  await seedDebit({
    tenantId: WORK_PROJECT_ID,
    budgetId: BUDGET_PROVIDER_ID,
    scope: "ORGANIZATION",
    bucketScopeId: `${ORG_ID}|provider:${MP_OPENAI_ID}`,
    window: "MONTH",
    amountUsd: "0.05",
    requestId: `req-bov-provider-${suffix}`,
  });
  // The member's own department bucket vs a colleague's: the member
  // must see only their own $2.00, never the group's $11.00.
  await seedDebit({
    tenantId: PERSONAL_PROJECT_ID,
    budgetId: BUDGET_GROUP_ID,
    scope: "GROUP",
    bucketScopeId: groupBucketScopeId(GROUP_ID, USER_ID),
    window: "WEEK",
    amountUsd: "2.00",
    requestId: `req-bov-group-self-${suffix}`,
  });
  await seedDebit({
    tenantId: WORK_PROJECT_ID,
    budgetId: BUDGET_GROUP_ID,
    scope: "GROUP",
    bucketScopeId: groupBucketScopeId(GROUP_ID, OTHER_USER_ID),
    window: "WEEK",
    amountUsd: "9.00",
    requestId: `req-bov-group-other-${suffix}`,
  });

  // The device-session record the CLI's bearer token resolves through,
  // so any test here can call the REST endpoint the CLI calls.
  if (!redisConnection) {
    throw new Error("these tests need a real Redis connection");
  }
  await redisConnection.set(
    `lwcli:access:${ACCESS_TOKEN}`,
    JSON.stringify({
      user_id: USER_ID,
      organization_id: ORG_ID,
      issued_at: Date.now(),
      expires_at: Date.now() + 60 * 60 * 1000,
    }),
    "EX",
    60 * 60,
  );
}

/** Tear it back down, ClickHouse rows and Redis session included. */
export async function teardownBudgetOverviewFixture(): Promise<void> {
  delete process.env.RELEASE_UI_AI_GOVERNANCE_ENABLED;
  await resetApp();
  const ch = getTestClickHouseClient();
  if (ch) {
    for (const tenantId of TENANTS) {
      await ch.command({
        query:
          "DELETE FROM gateway_budget_ledger_events WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
      });
      await ch.command({
        query:
          "DELETE FROM gateway_budget_scope_totals WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
      });
    }
  }
  if (redisConnection) await redisConnection.del(`lwcli:access:${ACCESS_TOKEN}`);
  await prisma.gatewayBudget.deleteMany({
    where: { organizationId: ORG_ID },
  });
  await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.groupMembership.deleteMany({ where: { groupId: GROUP_ID } });
  await prisma.group.deleteMany({ where: { id: GROUP_ID } });
  await prisma.modelProvider.deleteMany({ where: { id: MP_OPENAI_ID } });
  await prisma.project.deleteMany({
    where: { team: { organizationId: ORG_ID } },
  });
  await prisma.teamUser.deleteMany({
    where: { team: { organizationId: ORG_ID } },
  });
  await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.organizationUser.deleteMany({
    where: { organizationId: ORG_ID },
  });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.user.deleteMany({
    where: { id: { in: [USER_ID, OTHER_USER_ID, OUTSIDER_USER_ID] } },
  });
  await stopTestContainers();
}
