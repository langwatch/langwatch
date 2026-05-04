import { prisma } from "~/server/db";

async function main() {
  const updated = await prisma.routingPolicy.updateMany({
    where: { scope: "ORGANIZATION" },
    data: { scope: "organization" },
  });
  console.log(`[fix] updated ${updated.count} RoutingPolicy rows`);
  const policies = await prisma.routingPolicy.findMany({
    select: { id: true, scope: true, isDefault: true, name: true },
  });
  console.log("[fix] policies:", JSON.stringify(policies, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
