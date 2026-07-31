/**
 * Browser-QA fixture for the virtual-keys / budgets table polish.
 *
 * Mints the keys the screenshots need and prints their secrets. It does
 * NOT write spend: spend has to come from real requests through the local
 * gateway, otherwise the row reads a state production cannot produce (a
 * key that has never been used, with a bar showing money spent). Send the
 * traffic with the curl the script prints, then reload the page.
 *
 * Creates:
 *   - vkpolish-capped-daily   $0.10/day cap, drives the healthy bar
 *   - vkpolish-tight-cap      $0.0005/day cap, drives the breached bar
 *   - vkpolish-falls-back     FALLBACK_ALL, for the Routing column
 *   - vkpolish-pinned-policy  POLICY, for the Routing column
 * plus an organization budget and (if the org has a group) a group budget
 * so the Budgets page Scope column has every one-line treatment on screen.
 *
 * Idempotent: re-running removes its own rows, including the ledger and
 * rollup rows the previous run's traffic produced.
 *
 * Usage: npx tsx scripts/dogfooding/seed-vk-table-polish.ts ["<org name>"]
 */
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";

const TAG = "vkpolish";

async function main() {
  // Optional argv[2]: which organization to seed into, by slug or name.
  const wanted = process.argv[2];
  const org = await prisma.organization.findFirst({
    where: wanted ? { OR: [{ slug: wanted }, { name: wanted }] } : {},
    orderBy: { createdAt: "asc" },
    include: { teams: { include: { projects: true } } },
  });
  if (!org) throw new Error("no organization in this database");
  const team = org.teams[0];
  const project = team?.projects[0];
  if (!team || !project) throw new Error("no team/project in this database");
  const user = await prisma.user.findFirst();
  if (!user) throw new Error("no user in this database");

  console.log(`org=${org.name} team=${team.name} project=${project.name}`);

  const previous = await prisma.virtualKey.findMany({
    where: { organizationId: org.id, name: { startsWith: TAG } },
    select: { id: true },
  });
  await prisma.gatewayBudget.deleteMany({
    where: { organizationId: org.id, name: { startsWith: TAG } },
  });
  await prisma.virtualKey.deleteMany({
    where: { organizationId: org.id, name: { startsWith: TAG } },
  });
  await purgeSpend(
    project.id,
    previous.map((k) => k.id),
  );

  const service = VirtualKeyService.create(prisma);
  const policy = await prisma.routingPolicy.findFirst({
    where: { organizationId: org.id },
  });

  const capped = await service.create({
    organizationId: org.id,
    name: `${TAG}-capped-daily`,
    actorUserId: user.id,
    scopes: [{ scopeType: "PROJECT", scopeId: project.id }],
    budget: { window: "DAY", limitUsd: "0.10", onBreach: "WARN" },
  });
  const tight = await service.create({
    organizationId: org.id,
    name: `${TAG}-tight-cap`,
    actorUserId: user.id,
    scopes: [{ scopeType: "PROJECT", scopeId: project.id }],
    budget: { window: "DAY", limitUsd: "0.0005", onBreach: "WARN" },
  });
  await service.create({
    organizationId: org.id,
    name: `${TAG}-falls-back`,
    actorUserId: user.id,
    routingMode: "FALLBACK_ALL",
    scopes: [{ scopeType: "PROJECT", scopeId: project.id }],
  });
  if (policy) {
    await service.create({
      organizationId: org.id,
      name: `${TAG}-pinned-policy`,
      actorUserId: user.id,
      routingMode: "POLICY",
      routingPolicyId: policy.id,
      scopes: [{ scopeType: "PROJECT", scopeId: project.id }],
    });
  }

  await prisma.gatewayBudget.create({
    data: {
      organizationId: org.id,
      name: `${TAG} org monthly`,
      scopeType: "ORGANIZATION",
      scopeId: org.id,
      window: "MONTH",
      limitUsd: "500.00",
      onBreach: "WARN",
      createdById: user.id,
      resetsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const group = await prisma.group.findFirst({
    where: { organizationId: org.id },
  });
  if (group) {
    await prisma.gatewayBudget.create({
      data: {
        organizationId: org.id,
        name: `${TAG} group per member`,
        scopeType: "GROUP",
        scopeId: group.id,
        window: "MONTH",
        limitUsd: "25.00",
        onBreach: "BLOCK",
        createdById: user.id,
        resetsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  console.log("\nSend real traffic through the gateway, then reload:\n");
  for (const [label, created] of [
    ["capped-daily ($0.10/day)", capped],
    ["tight-cap ($0.0005/day)", tight],
  ] as const) {
    console.log(`# ${label}`);
    console.log(
      `curl -s http://localhost:3010/v1/chat/completions -H "Authorization: Bearer ${created.secret}" -H "Content-Type: application/json" -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"Say hi in five words."}]}'\n`,
    );
  }
  await prisma.$disconnect();
}

/**
 * Drop the ledger and rollup rows a previous run's traffic left behind.
 * The rollup is a materialized-view target, so deleting the source events
 * does not cascade; both need the sweep or the next run's bar reads the
 * last run's money.
 */
async function purgeSpend(tenantId: string, virtualKeyIds: string[]) {
  if (virtualKeyIds.length === 0) return;
  const client = await getClickHouseClientForProject(tenantId);
  if (!client) return;
  for (const table of [
    "gateway_budget_ledger_events",
    "gateway_budget_scope_totals",
  ]) {
    await client.command({
      query: `DELETE FROM ${table} WHERE TenantId = {tenantId:String} AND ScopeId IN ({ids:Array(String)})`,
      query_params: { tenantId, ids: virtualKeyIds },
    });
  }
}

void main();
