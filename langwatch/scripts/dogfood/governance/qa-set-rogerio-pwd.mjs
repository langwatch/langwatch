import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const email = "rogerio@langwatch.ai";
const newPassword = "RogerTest123!";
const hash = await bcrypt.hash(newPassword, 10);

const user = await prisma.user.findFirst({ where: { email } });
if (!user) { console.error("not found"); process.exit(1); }

let acc = await prisma.account.findFirst({ where: { userId: user.id, type: "credential" } });
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
      providerAccountId: user.id,
      password: hash,
    },
  });
  console.log("created credential account", acc.id);
}
console.log("OK email:", email, "password:", newPassword, "userId:", user.id);
await prisma.$disconnect();
