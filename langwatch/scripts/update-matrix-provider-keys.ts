// One-shot for iter 110 matrix — update the existing matrix-* ModelProvider
// rows with real credentials. Seed script left placeholders because
// OPENAI_API_KEY / etc. were unset on first run; this re-encrypts + stores.
//
// Usage (from langwatch/):
//   set -a; source .env; set +a
//   LANGWATCH_API_KEY=sk-lw-... pnpm tsx scripts/update-matrix-provider-keys.ts

import { readFileSync } from "fs";
import { prisma } from "../src/server/db";
import { ModelProviderRepository } from "../src/server/modelProviders/modelProvider.repository";

const UPDATES: {
  provider: string;
  env: Record<string, string | undefined>;
  deploymentMap?: Record<string, string>;
}[] = [
  {
    provider: "openai",
    env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
  },
  {
    provider: "anthropic",
    env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  },
  {
    provider: "gemini",
    env: { GOOGLE_API_KEY: process.env.GEMINI_API_KEY },
  },
  {
    provider: "bedrock",
    env: {
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_REGION_NAME: process.env.AWS_DEFAULT_REGION ?? "eu-central-1",
    },
  },
  {
    provider: "azure",
    env: {
      AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
      AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
    },
    // Azure routes on deployment name, not the bare model id. Customer's
    // Azure subscription maps "gpt-5-mini" → deployment "gpt-5-mini"
    // (defaulted) on the langwatchopenaisweden endpoint.
    deploymentMap: { "gpt-5-mini": "gpt-5-mini" },
  },
  {
    provider: "vertex_ai",
    env: {
      GOOGLE_APPLICATION_CREDENTIALS_JSON: process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf-8")
        : undefined,
      VERTEXAI_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
      VERTEXAI_LOCATION: process.env.GOOGLE_CLOUD_LOCATION,
    },
  },
];

async function main() {
  const apiKey = process.env.LANGWATCH_API_KEY;
  if (!apiKey) throw new Error("LANGWATCH_API_KEY required");
  const project = await prisma.project.findFirst({ where: { apiKey } });
  if (!project) throw new Error(`project not found for apiKey=${apiKey}`);

  const repo = new ModelProviderRepository(prisma);

  for (const { provider, env } of UPDATES) {
    const filtered = Object.fromEntries(
      Object.entries(env).filter(([, v]) => v !== undefined && v !== "")
    );
    if (Object.keys(filtered).length === 0) {
      console.log(`⊘ ${provider}: no env set — skipping`);
      continue;
    }

    const existing = await prisma.modelProvider.findFirst({
      where: { projectId: project.id, provider },
    });
    if (!existing) {
      console.log(`⊘ ${provider}: no existing row — run seed first`);
      continue;
    }

    await repo.update(existing.id, project.id, {
      enabled: true,
      customKeys: filtered,
    });
    console.log(`✓ ${provider}: updated row ${existing.id} with real creds`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
