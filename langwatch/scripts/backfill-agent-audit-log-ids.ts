/**
 * Backfill script: add missing agent IDs to pre-fix audit log records.
 *
 * Before the fix, agents.create and agents.copy audit logs did not include the
 * generated agent ID in args, making those events invisible in the history drawer.
 *
 * Strategy:
 *   - agents.create: find the Agent row created by the same user in the same
 *     project within 60s of the audit log timestamp, write its id into args.id
 *   - agents.copy: find the Agent row with copiedFromAgentId = args.agentId
 *     created by the same user in the target project within 60s, write its id
 *     into args.newAgentId
 *
 * Run with:
 *   DATABASE_URL=... npx tsx scripts/backfill-agent-audit-log-ids.ts
 *   DATABASE_URL=... npx tsx scripts/backfill-agent-audit-log-ids.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";

const DRY_RUN = process.argv.includes("--dry-run");
const WINDOW_MS = 60_000;

const prisma = new PrismaClient();

async function backfillCreate() {
  const logs = await prisma.auditLog.findMany({
    where: { action: "agents.create" },
  });

  const filteredLogs = logs.filter((l) => {
    const args = l.args as Record<string, unknown> | null;
    return !args?.["id"];
  });

  console.log(`agents.create logs missing args.id: ${filteredLogs.length}`);
  let patched = 0;

  for (const log of filteredLogs) {
    const windowStart = new Date(log.createdAt.getTime() - WINDOW_MS);
    const windowEnd = new Date(log.createdAt.getTime() + WINDOW_MS);

    const agent = await prisma.agent.findFirst({
      where: {
        projectId: log.projectId ?? undefined,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!agent) {
      console.warn(`  [SKIP] log ${log.id} — no matching agent found`);
      continue;
    }

    const updatedArgs = { ...(log.args as Record<string, unknown>), id: agent.id };

    if (DRY_RUN) {
      console.log(`  [DRY] log ${log.id} → args.id = ${agent.id}`);
    } else {
      await prisma.auditLog.update({
        where: { id: log.id },
        data: { args: updatedArgs },
      });
      console.log(`  [OK] log ${log.id} → args.id = ${agent.id}`);
    }
    patched++;
  }

  console.log(`agents.create: ${patched}/${filteredLogs.length} patched\n`);
}

async function backfillCopy() {
  const allCopyLogs = await prisma.auditLog.findMany({
    where: { action: "agents.copy" },
  });

  const logs = allCopyLogs.filter((l) => {
    const args = l.args as Record<string, unknown> | null;
    return !args?.["newAgentId"];
  });

  console.log(`agents.copy logs missing args.newAgentId: ${logs.length}`);
  let patched = 0;

  for (const log of logs) {
    const args = log.args as Record<string, unknown>;
    const sourceAgentId = args["agentId"] as string | undefined;

    if (!sourceAgentId) {
      console.warn(`  [SKIP] log ${log.id} — no args.agentId`);
      continue;
    }

    const windowStart = new Date(log.createdAt.getTime() - WINDOW_MS);
    const windowEnd = new Date(log.createdAt.getTime() + WINDOW_MS);

    const agent = await prisma.agent.findFirst({
      where: {
        copiedFromAgentId: sourceAgentId,
        projectId: log.projectId ?? undefined,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!agent) {
      console.warn(`  [SKIP] log ${log.id} — no matching copied agent found`);
      continue;
    }

    const updatedArgs = { ...args, newAgentId: agent.id };

    if (DRY_RUN) {
      console.log(`  [DRY] log ${log.id} → args.newAgentId = ${agent.id}`);
    } else {
      await prisma.auditLog.update({
        where: { id: log.id },
        data: { args: updatedArgs },
      });
      console.log(`  [OK] log ${log.id} → args.newAgentId = ${agent.id}`);
    }
    patched++;
  }

  console.log(`agents.copy: ${patched}/${logs.length} patched\n`);
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  await backfillCreate();
  await backfillCopy();

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
