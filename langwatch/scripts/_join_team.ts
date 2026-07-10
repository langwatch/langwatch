/** Dogfood helper: add nway@langwatch.local to the org/team owning d-1h5icu. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: "nway@langwatch.local" },
  });
  if (!user) throw new Error("user nway@langwatch.local not found");

  const project = await prisma.project.findFirst({
    where: { slug: "d-1h5icu" },
    include: { team: true },
  });
  if (!project) throw new Error("project d-1h5icu not found");

  const team = project.team;

  await prisma.organizationUser.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: team.organizationId,
      },
    },
    create: {
      userId: user.id,
      organizationId: team.organizationId,
      role: "ADMIN",
    },
    update: { role: "ADMIN" },
  });

  await prisma.teamUser.upsert({
    where: { userId_teamId: { userId: user.id, teamId: team.id } },
    create: { userId: user.id, teamId: team.id, role: "ADMIN" },
    update: { role: "ADMIN" },
  });

  console.log(`joined user ${user.email} to team ${team.slug} (org ${team.organizationId})`);
}

main().finally(() => prisma.$disconnect());
