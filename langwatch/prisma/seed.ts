import { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { ENTERPRISE_LICENSE_KEY } from "../ee/licensing/__tests__/fixtures/testLicenses";

const prisma = new PrismaClient();

async function main() {
  // Get API key from environment variable
  const apiKey = process.env.LANGWATCH_API_KEY;
  if (!apiKey) {
    throw new Error("LANGWATCH_API_KEY environment variable is required");
  }

  console.log(`🌱 Seeding database with API key: ${apiKey}`);

  // Create organization with enterprise license to avoid free plan limits in E2E tests
  const organization = await prisma.organization.create({
    data: {
      name: "CI Test Organization",
      slug: `ci-test-org-${nanoid()}`,
      license: ENTERPRISE_LICENSE_KEY,
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
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
    },
  });

  // Seed a default-model config at the organization scope so prompt-
  // create + workflow runs in e2e tests resolve a model without
  // requiring CI to also seed model-providers. Mirrors production
  // first-provider onboarding: a fresh org needs SOMETHING the
  // cascade can hand back before any prompt/eval can land.
  const defaultConfig = await prisma.modelDefaultConfig.create({
    data: {
      id: nanoid(),
      organizationId: organization.id,
      config: {
        DEFAULT: "openai/gpt-5-mini",
        FAST: "openai/gpt-5-mini",
        EMBEDDINGS: "openai/text-embedding-3-small",
      },
    },
  });
  await prisma.modelDefaultConfigScope.create({
    data: {
      id: nanoid(),
      configId: defaultConfig.id,
      scopeType: "ORGANIZATION",
      scopeId: organization.id,
    },
  });

  console.log(`✅ Created test project with ID: ${project.id}`);
  console.log(`✅ API Key: ${project.apiKey}`);
  console.log(`✅ Seeded default-model config at organization scope`);
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
