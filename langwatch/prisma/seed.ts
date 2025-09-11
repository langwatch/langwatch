import { PrismaClient } from "@prisma/client";
import { customAlphabet } from "nanoid";

const prisma = new PrismaClient();

const generateApiKey = (): string => {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const randomPart = customAlphabet(alphabet, 48)();
  return `sk-lw-${randomPart}`;
};

// Get API key from environment or generate one for E2E tests
const E2E_API_KEY = process.env.E2E_LANGWATCH_API_KEY;
if (!E2E_API_KEY) {
  throw new Error("E2E_LANGWATCH_API_KEY environment variable is required");
}

async function main() {
  console.log("🌱 Seeding database for E2E tests...");

  // Create organization
  const organization = await prisma.organization.upsert({
    where: { slug: "test-organization" },
    update: {},
    create: {
      name: "Test Organization",
      slug: "test-organization",
    },
  });
  console.log(`✅ Organization: ${organization.name}`);

  // Create team
  const team = await prisma.team.upsert({
    where: {
      slug_organizationId: {
        slug: "test-team",
        organizationId: organization.id,
      },
    },
    update: {},
    create: {
      name: "Test Team",
      slug: "test-team",
      organizationId: organization.id,
    },
  });
  console.log(`✅ Team: ${team.name}`);

  // Create user
  const user = await prisma.user.upsert({
    where: { email: "test-user@example.com" },
    update: {},
    create: {
      name: "Test User",
      email: "test-user@example.com",
    },
  });
  console.log(`✅ User: ${user.name}`);

  // Create team user relationship
  await prisma.teamUser.upsert({
    where: {
      userId_teamId: {
        userId: user.id,
        teamId: team.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      teamId: team.id,
      role: "ADMIN",
    },
  });

  // Create organization user relationship
  await prisma.organizationUser.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: organization.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      organizationId: organization.id,
      role: "ADMIN",
    },
  });

  // Create project with E2E API key
  const project = await prisma.project.upsert({
    where: { id: "test-project-id" },
    update: {
      apiKey: E2E_API_KEY,
    },
    create: {
      id: "test-project-id",
      name: "Test Project",
      slug: "test-project",
      apiKey: E2E_API_KEY,
      teamId: team.id,
      language: "typescript",
      framework: "langwatch",
      piiRedactionLevel: "DISABLED",
      capturedInputVisibility: "VISIBLE_TO_ALL",
      capturedOutputVisibility: "VISIBLE_TO_ALL",
    },
  });
  console.log(`✅ Project: ${project.name}`);
  console.log(`🔑 API Key: ${project.apiKey}`);

  console.log("🎉 Database seeded successfully for E2E tests!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
