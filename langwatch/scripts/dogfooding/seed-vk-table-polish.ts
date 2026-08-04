/**
 * Browser-QA fixture for the virtual-keys / budgets table polish.
 *
 * Mints the keys the screenshots need. It does NOT write spend: spend has
 * to come from real requests through the local gateway, otherwise the row
 * reads a state production cannot produce (a key that has never been used,
 * with a bar showing money spent). Send the traffic with the curl the
 * script prints, then reload the page.
 *
 * Creates:
 *   - vkpolish-capped-daily   daily cap, drives the healthy bar
 *   - vkpolish-tight-cap      tighter daily cap, drives the breached bar
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
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import { nextResetAt } from "~/server/gateway/budgetWindow";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";

const TAG = "vkpolish";

/** Gitignored, and written 0600 so the secrets never reach the terminal. */
const SECRETS_FILE = resolve(
  import.meta.dirname,
  "../../../.claude/tmp/vkpolish-secrets.env",
);

type SeedTarget = {
  organizationId: string;
  projectId: string;
  userId: string;
  routingPolicyId: string | null;
  groupId: string | null;
};

async function resolveTarget(wanted?: string): Promise<SeedTarget> {
  const org = await prisma.organization.findFirst({
    where: wanted ? { OR: [{ slug: wanted }, { name: wanted }] } : {},
    orderBy: { createdAt: "asc" },
    include: { teams: { include: { projects: true } } },
  });
  if (!org) throw new Error("no organization in this database");
  const project = org.teams[0]?.projects[0];
  if (!project) throw new Error("no team/project in this database");
  // A member of THIS organization: the id becomes `actorUserId` on the keys
  // and `createdById` on the budgets, so an unrelated user would stamp rows
  // with an actor who cannot see them.
  const membership = await prisma.organizationUser.findFirst({
    where: { organizationId: org.id },
    select: { userId: true },
  });
  if (!membership) {
    throw new Error(`organization ${org.name} has no members to act as`);
  }

  const [policy, group] = await Promise.all([
    prisma.routingPolicy.findFirst({ where: { organizationId: org.id } }),
    prisma.group.findFirst({ where: { organizationId: org.id } }),
  ]);
  console.log(`org=${org.name} project=${project.name}`);
  return {
    organizationId: org.id,
    projectId: project.id,
    userId: membership.userId,
    routingPolicyId: policy?.id ?? null,
    groupId: group?.id ?? null,
  };
}

/**
 * Drop this fixture's previous rows, including the ledger and rollup rows
 * the last run's traffic produced. The rollup is a materialized-view
 * target, so deleting the source events does not cascade; both need the
 * sweep or the next run's bar reads the last run's money.
 *
 * ClickHouse goes first, and a failure there aborts before Postgres is
 * touched: the key ids are the only handle on those rows, so deleting the
 * keys first and then failing would strand the spend permanently. The
 * deletes are synchronous for the same reason: an accepted-but-unfinished
 * mutation is indistinguishable from a completed one, and the next run
 * would read the old money.
 *
 * The sweep matches virtual-key ScopeIds and nothing else. The fixture's
 * ORGANIZATION and GROUP budgets bucket under the organization id and
 * under `groupId:principalUserId`, and those buckets carry every member's
 * real spend rather than only this fixture's. Widening the sweep to reach
 * them would delete other people's money, so they are left in place and
 * their totals carry across runs.
 */
async function purgePrevious(target: SeedTarget) {
  const previous = await prisma.virtualKey.findMany({
    where: { organizationId: target.organizationId, name: { startsWith: TAG } },
    select: { id: true },
  });

  if (previous.length > 0) {
    const client = await getClickHouseClientForProject(target.projectId);
    if (!client) {
      throw new Error(
        `refusing to delete ${previous.length} previous fixture key(s): no ClickHouse client for ${target.projectId}, so their ledger and rollup rows would be stranded`,
      );
    }
    for (const table of [
      "gateway_budget_ledger_events",
      "gateway_budget_scope_totals",
    ]) {
      await client.command({
        query: `DELETE FROM ${table} WHERE TenantId = {tenantId:String} AND ScopeId IN ({ids:Array(String)})`,
        query_params: {
          tenantId: target.projectId,
          ids: previous.map((k) => k.id),
        },
        clickhouse_settings: { mutations_sync: "2" },
      });
    }
  }

  await prisma.gatewayBudget.deleteMany({
    where: { organizationId: target.organizationId, name: { startsWith: TAG } },
  });
  await prisma.virtualKey.deleteMany({
    where: { organizationId: target.organizationId, name: { startsWith: TAG } },
  });
}

async function createKeys(target: SeedTarget): Promise<Map<string, string>> {
  const service = VirtualKeyService.create(prisma);
  const base = {
    organizationId: target.organizationId,
    actorUserId: target.userId,
    scopes: [{ scopeType: "PROJECT" as const, scopeId: target.projectId }],
  };

  const capped = await service.create({
    ...base,
    name: `${TAG}-capped-daily`,
    budget: { window: "DAY", limitUsd: "0.003", onBreach: "WARN" },
  });
  const tight = await service.create({
    ...base,
    name: `${TAG}-tight-cap`,
    budget: { window: "DAY", limitUsd: "0.00015", onBreach: "WARN" },
  });
  await service.create({
    ...base,
    name: `${TAG}-falls-back`,
    routingMode: "FALLBACK_ALL",
  });
  if (target.routingPolicyId) {
    await service.create({
      ...base,
      name: `${TAG}-pinned-policy`,
      routingMode: "POLICY",
      routingPolicyId: target.routingPolicyId,
    });
  }
  return new Map([
    ["VKPOLISH_CAPPED_SECRET", capped.secret],
    ["VKPOLISH_TIGHT_SECRET", tight.secret],
  ]);
}

async function createInheritedBudgets(target: SeedTarget) {
  const common = {
    organizationId: target.organizationId,
    createdById: target.userId,
    // The same computation the service uses, so a monthly budget shows a
    // month boundary rather than "resets in about 24 hours".
    resetsAt: nextResetAt("MONTH"),
  };
  await prisma.gatewayBudget.create({
    data: {
      ...common,
      name: `${TAG} org monthly`,
      scopeType: "ORGANIZATION",
      scopeId: target.organizationId,
      window: "MONTH",
      limitUsd: "500.00",
      onBreach: "WARN",
    },
  });
  if (!target.groupId) return;
  await prisma.gatewayBudget.create({
    data: {
      ...common,
      name: `${TAG} group per member`,
      scopeType: "GROUP",
      scopeId: target.groupId,
      window: "MONTH",
      limitUsd: "25.00",
      onBreach: "BLOCK",
    },
  });
}

/**
 * Secrets go to a 0600 file, never to stdout: a terminal scrollback, a CI
 * log or a pasted screenshot would each be a live key in the clear. The
 * printed command sources the file instead of embedding the value.
 */
function writeSecrets(secrets: Map<string, string>) {
  mkdirSync(dirname(SECRETS_FILE), { recursive: true });
  const body = [...secrets]
    .map(([name, value]) => `${name}=${value}`)
    .join("\n");
  writeFileSync(SECRETS_FILE, `${body}\n`, { mode: 0o600 });
  chmodSync(SECRETS_FILE, 0o600);

  console.log(`\nSecrets written to ${SECRETS_FILE} (0600).`);
  console.log("Send real traffic through the gateway, then reload:\n");
  console.log(`  set -a && . ${SECRETS_FILE} && set +a`);
  for (const name of secrets.keys()) {
    console.log(
      `  curl -s http://localhost:3010/v1/chat/completions -H "Authorization: Bearer $${name}" -H "Content-Type: application/json" -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"Say hi in five words."}]}'`,
    );
  }
}

async function main() {
  // Optional argv[2]: which organization to seed into, by slug or name.
  const target = await resolveTarget(process.argv[2]);
  await purgePrevious(target);
  const secrets = await createKeys(target);
  await createInheritedBudgets(target);
  writeSecrets(secrets);
  await prisma.$disconnect();
}

void main();
