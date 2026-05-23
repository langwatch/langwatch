import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORG_ID = "organization_0000HrVrdhNtZNrM5ysajP4tyK9Cq";
const TEAM_NAME = "Ariana Zone Co";
const EMAIL = "rogerio@langwatch.ai";

const team = await prisma.team.findFirst({
  where: { organizationId: ORG_ID, name: TEAM_NAME },
});
if (!team) {
  console.error("team not found");
  process.exit(1);
}

const existing = await prisma.user.findFirst({ where: { email: EMAIL } });
let userId;
if (existing) {
  userId = existing.id;
  console.log("user already exists", userId);
} else {
  const created = await prisma.user.create({
    data: {
      email: EMAIL,
      name: "Rogerio (Anthropic OAuth)",
      emailVerified: true,
    },
  });
  userId = created.id;
  console.log("created user", userId);
}

const orgUser = await prisma.organizationUser.findFirst({
  where: { userId, organizationId: ORG_ID },
});
if (!orgUser) {
  await prisma.organizationUser.create({
    data: { userId, organizationId: ORG_ID, role: "MEMBER" },
  });
  console.log("added to org");
} else {
  console.log("org membership already exists");
}

const teamUser = await prisma.teamUser.findFirst({
  where: { userId, teamId: team.id },
});
if (!teamUser) {
  await prisma.teamUser.create({
    data: { userId, teamId: team.id, role: "MEMBER" },
  });
  console.log("added to team");
} else {
  console.log("team membership already exists");
}

console.log("done — rogerio@langwatch.ai is now a member of Ariana Zone Co");
await prisma.$disconnect();
