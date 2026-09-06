import bcrypt from "bcrypt";
import { PrismaClient } from "../../../src/generated/prisma/client";
import { createPrismaPgAdapter } from "../../../src/server/prismaPgAdapter";

const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? ""),
});
const email = "rogerio@langwatch.ai";
const newPassword = "RogerTest123!";
const hash = await bcrypt.hash(newPassword, 10);

const user = await prisma.user.findFirst({ where: { email } });
if (!user) {
  console.error("not found");
  process.exit(1);
}

let acc = await prisma.account.findFirst({
  where: { userId: user.id, type: "credential" },
});
if (acc) {
  await prisma.account.update({
    where: { id: acc.id },
    data: { password: hash },
  });
  console.log("updated existing credential account");
} else {
  acc = await prisma.account.create({
    data: {
      userId: user.id,
      type: "credential",
      provider: "credential",
      // better-auth 1.7 keys an account by `(issuer, accountId)`; the local
      // credential provider's issuer is `local:credential`, not
      // `local:oauth:credential`. Without it sign-in cannot find this row.
      issuer: "local:credential",
      providerAccountId: user.id,
      password: hash,
    },
  });
  console.log("created credential account", acc.id);
}
console.log("OK email:", email, "password:", newPassword, "userId:", user.id);
await prisma.$disconnect();
