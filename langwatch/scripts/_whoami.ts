import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const p = await prisma.project.findFirst({ where: { slug: "d-1h5icu" }, include: { team: { include: { organization: true } } } });
  console.log("project:", p?.slug, "team:", p?.team?.name, "org slug:", p?.team?.organization?.slug);
  const users = await prisma.user.findMany({ select: { email: true } });
  console.log("users:", users.map(u => u.email).join(", "));
}
main().finally(() => prisma.$disconnect());
