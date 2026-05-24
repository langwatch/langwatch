/**
 * One-shot cleanup: delete duplicate ModelProvider rows in the dogfood
 * org created before the upsertModelProviderByName lookup was widened
 * to match across input scopes. Keeps the oldest row per (organization,
 * name) pair; removes the rest along with their scope rows.
 */
import { prisma } from "~/server/db";

const ORG_SLUG = process.env.ORG_SLUG ?? "acme";

async function main() {
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true },
  });
  if (!org) {
    console.error(`org ${ORG_SLUG} not found`);
    process.exit(2);
  }

  const teams = await prisma.team.findMany({
    where: { organizationId: org.id },
    select: { id: true, projects: { select: { id: true } } },
  });
  const teamIds = teams.map((t) => t.id);
  const projectIds = teams.flatMap((t) => t.projects.map((p) => p.id));

  const reachable = await prisma.modelProvider.findMany({
    where: {
      scopes: {
        some: {
          OR: [
            { scopeType: "ORGANIZATION", scopeId: org.id },
            ...(teamIds.length
              ? [{ scopeType: "TEAM" as const, scopeId: { in: teamIds } }]
              : []),
            ...(projectIds.length
              ? [{ scopeType: "PROJECT" as const, scopeId: { in: projectIds } }]
              : []),
          ],
        },
      },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true },
  });

  const seen = new Map<string, string>();
  const toDelete: string[] = [];
  for (const mp of reachable) {
    if (seen.has(mp.name)) {
      toDelete.push(mp.id);
    } else {
      seen.set(mp.name, mp.id);
    }
  }

  if (toDelete.length === 0) {
    console.log("no duplicates");
    return;
  }

  console.log(`deleting ${toDelete.length} duplicate MPs:`, toDelete);
  await prisma.modelProviderScope.deleteMany({
    where: { modelProviderId: { in: toDelete } },
  });
  await prisma.modelProvider.deleteMany({ where: { id: { in: toDelete } } });
  console.log("done");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
