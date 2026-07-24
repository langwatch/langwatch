import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const email = "ariana-zone-admin@acme.test";
const newPassword = "ArianaTest123!";
const hash = await bcrypt.hash(newPassword, 12);

const user = await prisma.user.findFirst({ where: { email } });
if (!user) {
  console.error("User not found:", email);
  process.exit(1);
}

// password lives on Account row for credentials provider
const accounts = await prisma.account.findMany({ where: { userId: user.id } });
console.log("accounts:", accounts.map(a => ({ provider: a.provider, type: a.type })));

const cred = accounts.find(a => a.type === "credential" || a.provider === "credential");
if (!cred) { console.error("no credential account"); process.exit(1); }
await prisma.account.update({
  where: { id: cred.id },
  data: { password: hash },
});
console.log("updated account.password");
console.log(JSON.stringify({ ok: true, email, password: newPassword, userId: user.id }));
await prisma.$disconnect();
