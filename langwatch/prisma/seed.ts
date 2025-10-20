import { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";

const prisma = new PrismaClient();

async function main() {
  // Get API key from environment variable
  const apiKey = process.env.LANGWATCH_API_KEY;
  if (!apiKey) {
    throw new Error("LANGWATCH_API_KEY environment variable is required");
  }

  console.log(`🌱 Seeding database with API key: ${apiKey}`);

  // Create organization
  const organization = await prisma.organization.create({
    data: {
      name: "CI Test Organization",
      slug: `ci-test-org-${nanoid()}`,
    },
  });

  // Create team
  const team = await prisma.team.create({
    data: {
      name: "CI Test Team",
      slug: `ci-test-team-${nanoid()}`,
      organizationId: organization.id,
    },
  });

  // Create project with the specified API key
  const project = await prisma.project.create({
    data: {
      id: nanoid(),
      name: "CI Test Project",
      slug: `ci-test-project-${nanoid()}`,
      apiKey: apiKey,
      teamId: team.id,
      language: "en",
      framework: "langchain",
      firstMessage: false,
      integrated: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      userLinkTemplate: null,
      piiRedactionLevel: "ESSENTIAL",
      capturedInputVisibility: "VISIBLE_TO_ALL",
      capturedOutputVisibility: "VISIBLE_TO_ALL",
      defaultModel: null,
      topicClusteringModel: null,
      embeddingsModel: null,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
    },
  });

  console.log(`✅ Created test project with ID: ${project.id}`);
  console.log(`✅ API Key: ${project.apiKey}`);
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
