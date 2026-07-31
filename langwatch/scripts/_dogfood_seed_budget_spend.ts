/**
 * One-off dogfood seeding: write a few gateway-budget ledger debits for
 * the ACME org so the budget-overview surfaces show real spend.
 * Run: pnpm exec tsx scripts/_dogfood_seed_budget_spend.ts
 */
import { PrismaClient } from "@prisma/client";

import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "../src/server/clickhouse/clickhouseClient";
import { GatewayBudgetClickHouseRepository } from "../src/server/gateway/budget.clickhouse.repository";

const prisma = new PrismaClient();

const ORG_ID = "J4yAt15xinnTcfCJePqAP";
const USER_ID = "gSs3Si_2MZYilC3tsZzl0";
const ORG_BUDGET_ID = "dogfood-org-budget-acme";
const PRINCIPAL_BUDGET_ID = `dogfood-principal-budget-${USER_ID}`;

async function main() {
  if (!isClickHouseEnabled()) throw new Error("ClickHouse not enabled");
  const projects = await prisma.project.findMany({
    where: { team: { organizationId: ORG_ID }, archivedAt: null },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (projects.length === 0) throw new Error("no ACME projects");
  const vk = await prisma.virtualKey.findFirst({
    where: { organizationId: ORG_ID, principalUserId: USER_ID },
    select: { id: true },
  });
  const repo = new GatewayBudgetClickHouseRepository(async (projectId) => {
    const client = await getClickHouseClientForProject(projectId);
    if (!client) throw new Error(`no CH client for ${projectId}`);
    return client;
  });

  const base = {
    scope: "ORGANIZATION" as const,
    scopeId: ORG_ID,
    window: "MONTH" as const,
    virtualKeyId: vk?.id ?? "vk-dogfood",
    tokensInput: 1200,
    tokensOutput: 300,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    model: "gpt-5-mini",
    status: "SUCCESS" as const,
    occurredAt: new Date(),
  };
  await repo.insertDebit([
    {
      ...base,
      tenantId: projects[0]!.id,
      budgetId: ORG_BUDGET_ID,
      gatewayRequestId: "dogfood-bov-org-1",
      amountUsd: "1.50",
    },
  ]);
  await repo.insertDebit([
    {
      ...base,
      tenantId: projects[1]?.id ?? projects[0]!.id,
      budgetId: ORG_BUDGET_ID,
      gatewayRequestId: "dogfood-bov-org-2",
      amountUsd: "0.93",
    },
  ]);
  await repo.insertDebit([
    {
      ...base,
      scope: "PRINCIPAL" as const,
      scopeId: USER_ID,
      tenantId: projects[0]!.id,
      budgetId: PRINCIPAL_BUDGET_ID,
      gatewayRequestId: "dogfood-bov-principal-1",
      amountUsd: "0.10",
    },
  ]);
  console.log(
    `seeded debits: org $1.50 (${projects[0]!.name}) + $0.93 (${projects[1]?.name ?? projects[0]!.name}), principal $0.10`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
