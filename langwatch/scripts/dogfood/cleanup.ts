/**
 * Lane-B iter 24 — cleanup helper for dogfood seeds.
 *
 * Deletes org + team + user + IngestionSource + hidden Gov Project for a
 * given dogfood namespace prefix. Handles the dbOrganizationIdProtection
 * middleware ceremony (deleteMany requires explicit organizationId).
 *
 * Usage (from worktree root):
 *   cd langwatch && pnpm tsx ../.monitor-logs/lane-b-dogfood/cleanup.ts \
 *     --organization-id <orgId>                     # delete one
 *   cd langwatch && pnpm tsx ../.monitor-logs/lane-b-dogfood/cleanup.ts \
 *     --slug-prefix dogfood-org-                    # delete all dogfood orgs
 */
import { prisma } from "~/server/db";

interface Args {
  organizationId?: string;
  slugPrefix?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--organization-id") out.organizationId = argv[++i];
    else if (arg === "--slug-prefix") out.slugPrefix = argv[++i];
  }
  return out;
}

async function deleteOrg(orgId: string): Promise<void> {
  process.stderr.write(`[cleanup] deleting organizationId=${orgId}\n`);
  await prisma.ingestionSource
    .deleteMany({ where: { organizationId: orgId } })
    .catch((e) => process.stderr.write(`[cleanup] ingestionSource: ${String(e)}\n`));
  await prisma.project
    .deleteMany({ where: { team: { organizationId: orgId } } })
    .catch((e) => process.stderr.write(`[cleanup] project: ${String(e)}\n`));
  await prisma.organizationUser
    .deleteMany({ where: { organizationId: orgId } })
    .catch((e) => process.stderr.write(`[cleanup] organizationUser: ${String(e)}\n`));
  await prisma.team
    .deleteMany({ where: { organizationId: orgId } })
    .catch((e) => process.stderr.write(`[cleanup] team: ${String(e)}\n`));
  await prisma.organization
    .delete({ where: { id: orgId } })
    .catch((e) => process.stderr.write(`[cleanup] organization: ${String(e)}\n`));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.organizationId) {
    await deleteOrg(args.organizationId);
  } else if (args.slugPrefix) {
    const orgs = await prisma.organization.findMany({
      where: { slug: { startsWith: args.slugPrefix } },
      select: { id: true, slug: true },
    });
    process.stderr.write(`[cleanup] found ${orgs.length} org(s) with slug-prefix=${args.slugPrefix}\n`);
    for (const o of orgs) {
      await deleteOrg(o.id);
    }
    const userPrefix = args.slugPrefix.replace(/-org-/, "-");
    const users = await prisma.user.findMany({
      where: { email: { startsWith: userPrefix } },
      select: { id: true, email: true },
    });
    for (const u of users) {
      await prisma.user.delete({ where: { id: u.id } }).catch(() => undefined);
    }
    process.stderr.write(`[cleanup] deleted ${users.length} dogfood user(s)\n`);
  } else {
    process.stderr.write("[cleanup] need --organization-id or --slug-prefix\n");
    process.exitCode = 1;
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(`[cleanup] error: ${String(err)}\n`);
  process.exitCode = 1;
});
