import { prisma } from "../../../src/server/db";

async function main() {
  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { teams: true } },
    },
    take: 20,
  });
  console.log(JSON.stringify(orgs, null, 2));
}

main().then(() => process.exit(0));
