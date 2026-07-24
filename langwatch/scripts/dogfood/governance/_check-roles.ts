import { PrismaClient } from "@prisma/client";

const email = process.argv[2] ?? "rogerio@langwatch.ai";
const prisma = new PrismaClient();

void (async () => {
  try {
    const u = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    console.log("user:", u);
    if (!u) return;

    const ous = await prisma.organizationUser.findMany({
      where: { userId: u.id },
      select: { organizationId: true, role: true },
    });
    console.log("orgUsers:", ous);

    const rbs = await prisma.roleBinding.findMany({
      where: { userId: u.id },
      select: {
        id: true,
        organizationId: true,
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    });
    console.log("roleBindings:", JSON.stringify(rbs, null, 2));
  } finally {
    await prisma.$disconnect();
  }
})();
