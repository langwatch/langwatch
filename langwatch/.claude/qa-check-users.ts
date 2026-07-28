import { prisma } from "../src/server/db";
async function main() {
  const users = await prisma.user.findMany({
    where: { email: { contains: "guardrail-qa" } },
    select: { id: true, email: true, emailVerified: true },
  });
  console.log(JSON.stringify(users, null, 2));
}
main().finally(() => process.exit(0));
