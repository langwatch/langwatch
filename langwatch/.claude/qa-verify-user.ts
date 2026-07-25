import { prisma } from "../src/server/db";
async function main() {
  const user = await prisma.user.update({
    where: { email: "guardrail-qa2@langwatch.local" },
    data: { emailVerified: true },
    select: { id: true, email: true, emailVerified: true },
  });
  console.log(JSON.stringify(user, null, 2));
}
main().finally(() => process.exit(0));
