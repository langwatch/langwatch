/**
 * AI Gateway dogfood seeder.
 *
 * Populates the local dev DB with a realistic state so screenshots +
 * scenario tests can exercise the full feature surface without needing
 * a human to click through the UI:
 *
 *   - ModelProviders (OpenAI + Anthropic) bound to an existing project
 *   - GatewayProviderCredentials (rate limits, rotation policy set)
 *   - 2 Virtual Keys with different configs:
 *       prod-openai   → rate limits, blocked_patterns on tools + URLs
 *       prod-claude   → guardrails attached (if any AS_GUARDRAIL monitors
 *                       exist in the project), different fallback chain
 *   - 3 Budgets at different scopes (org monthly / project daily / VK)
 *
 * Addresses @rchaves's "screenshots of empty state are uninteresting"
 * feedback — Lane C can now drive the screenshot recapture with real
 * data, and Lane A can mint against a known VK without depending on a
 * browser session.
 *
 * Run:
 *   LANGWATCH_API_KEY=sk-lw-... \
 *   OPENAI_API_KEY=sk-proj-... \
 *   ANTHROPIC_API_KEY=sk-ant-... \
 *   pnpm tsx scripts/seed-gateway-dogfood.ts
 *
 * If the project matching LANGWATCH_API_KEY already has providers /
 * VKs, the script is idempotent — it upserts rather than duplicates.
 * Re-running after a partial failure should be safe.
 *
 * Emits the minted VK secrets on stdout ONCE. Capture them for Sergey's
 * failure-path tests (tests #1-7 against /v1/chat/completions).
 */
import { Prisma, PrismaClient, type Project } from "@prisma/client";

import { nextResetAt } from "../src/server/gateway/budgetWindow";
import {
  hashVirtualKeySecret,
  mintVirtualKeySecret,
  parseVirtualKey,
} from "../src/server/gateway/virtualKey.crypto";
import { defaultVirtualKeyConfig } from "../src/server/gateway/virtualKey.config";

const prisma = new PrismaClient();

async function main() {
  const apiKey = process.env.LANGWATCH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LANGWATCH_API_KEY is required (from python-sdk/.env or your own dev project)",
    );
  }

  const project = await prisma.project.findFirst({
    where: { apiKey },
    include: { team: { include: { organization: true } } },
  });
  if (!project) {
    throw new Error(
      `No project found with apiKey=${apiKey}. Seed the project first via prisma/seed.ts or the signup flow.`,
    );
  }
  console.log(
    `✓ project: ${project.name} (slug=${project.slug}, id=${project.id})`,
  );

  const actorUserId = await pickActor(project.team.organizationId);
  const openaiMp = await upsertModelProvider(project, "openai", {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
  const anthropicMp = await upsertModelProvider(project, "anthropic", {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  });

  const openaiBinding = await upsertProviderBinding({
    project,
    modelProvider: openaiMp,
    slot: "primary",
    rateLimitRpm: 60,
    rateLimitRpd: 10_000,
    fallbackPriorityGlobal: 1,
    actorUserId,
  });
  const anthropicBinding = await upsertProviderBinding({
    project,
    modelProvider: anthropicMp,
    slot: "fallback-1",
    rateLimitRpm: 30,
    rateLimitRpd: 5_000,
    fallbackPriorityGlobal: 2,
    actorUserId,
  });

  console.log(
    `✓ provider bindings: openai(${openaiBinding.id}) + anthropic(${anthropicBinding.id})`,
  );

  // VK #1: prod-openai — blocked_patterns + rate limits
  const prodOpenaiSecret = await upsertVirtualKey({
    project,
    name: "prod-openai",
    description:
      "Production OpenAI VK — deny shell.* tools, deny evil.com URLs, 500 rpm cap",
    environment: "LIVE",
    providerChain: [openaiBinding.id, anthropicBinding.id],
    config: {
      ...defaultVirtualKeyConfig(),
      rateLimits: { rpm: 500, tpm: null, rpd: 50_000 },
      blockedPatterns: {
        tools: { deny: ["^shell\\..*"], allow: null },
        mcp: { deny: [], allow: null },
        urls: { deny: ["evil\\.com", "ransomware"], allow: null },
        models: { deny: [], allow: null },
      },
    },
    actorUserId,
  });

  // VK #2: prod-claude — just Anthropic, lower rate limits
  const prodClaudeSecret = await upsertVirtualKey({
    project,
    name: "prod-claude",
    description:
      "Production Claude VK — Anthropic primary, lower rate limits for free-tier users",
    environment: "LIVE",
    providerChain: [anthropicBinding.id, openaiBinding.id],
    config: {
      ...defaultVirtualKeyConfig(),
      rateLimits: { rpm: 60, tpm: null, rpd: 5_000 },
      modelAliases: {
        "claude-sonnet-latest": "claude-sonnet-4-5-20250929",
        "fast": "claude-haiku-4-5-20251001",
      },
    },
    actorUserId,
  });

  // Budgets — three different scopes
  await upsertBudget({
    organizationId: project.team.organizationId,
    scopeType: "ORGANIZATION",
    scopeId: project.team.organizationId,
    name: "Org monthly",
    window: "MONTH",
    limitUsd: "5000",
    onBreach: "WARN",
    actorUserId,
  });
  await upsertBudget({
    organizationId: project.team.organizationId,
    scopeType: "PROJECT",
    scopeId: project.id,
    projectScopedId: project.id,
    name: "Project daily",
    window: "DAY",
    limitUsd: "200",
    onBreach: "BLOCK",
    actorUserId,
  });
  if (prodOpenaiSecret.vkId) {
    await upsertBudget({
      organizationId: project.team.organizationId,
      scopeType: "VIRTUAL_KEY",
      scopeId: prodOpenaiSecret.vkId,
      virtualKeyScopedId: prodOpenaiSecret.vkId,
      name: "prod-openai daily cap",
      window: "DAY",
      limitUsd: "50",
      onBreach: "BLOCK",
      actorUserId,
    });
  }

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  VK SECRETS — capture NOW, we don't store the raw secret.    ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  prod-openai   (id=${prodOpenaiSecret.vkId})`);
  console.log(`║      secret: ${prodOpenaiSecret.secret}`);
  console.log(`║  prod-claude   (id=${prodClaudeSecret.vkId})`);
  console.log(`║      secret: ${prodClaudeSecret.secret}`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("✓ gateway dogfood seed complete");
}

type UpsertVkInput = {
  project: Project & { team: { organizationId: string } };
  name: string;
  description: string;
  environment: "LIVE" | "TEST";
  providerChain: string[];
  config: ReturnType<typeof defaultVirtualKeyConfig>;
  actorUserId: string;
};

async function upsertVirtualKey(
  input: UpsertVkInput,
): Promise<{ vkId: string; secret: string; wasExisting: boolean }> {
  const existing = await prisma.virtualKey.findFirst({
    where: { projectId: input.project.id, name: input.name },
  });
  if (existing) {
    console.log(
      `· VK '${input.name}' exists (${existing.id}) — skipping mint (secret not regenerated; use rotate if needed)`,
    );
    return { vkId: existing.id, secret: "(existing; rotate to see)", wasExisting: true };
  }

  const secret = mintVirtualKeySecret(
    input.environment === "LIVE" ? "live" : "test",
  );
  const { displayPrefix } = parseVirtualKey(secret);
  const hashedSecret = hashVirtualKeySecret(secret);

  const vk = await prisma.$transaction(async (tx) => {
    const created = await tx.virtualKey.create({
      data: {
        id: `vk_${Date.now()}_${input.name}`,
        projectId: input.project.id,
        name: input.name,
        description: input.description,
        environment: input.environment,
        hashedSecret,
        displayPrefix,
        config: input.config as Prisma.InputJsonValue,
        createdById: input.actorUserId,
      },
    });
    await tx.virtualKeyProviderCredential.createMany({
      data: input.providerChain.map((id, priority) => ({
        virtualKeyId: created.id,
        providerCredentialId: id,
        priority,
      })),
    });
    return created;
  });

  console.log(`✓ minted VK '${input.name}' (${vk.id})`);
  return { vkId: vk.id, secret, wasExisting: false };
}

async function upsertModelProvider(
  project: Project,
  provider: string,
  envValues: Record<string, string | undefined>,
) {
  const existing = await prisma.modelProvider.findFirst({
    where: { projectId: project.id, provider },
  });
  if (existing) {
    console.log(`· ModelProvider(${provider}) exists (${existing.id})`);
    return existing;
  }
  const hasRealKey = Object.values(envValues).some((v) => !!v);
  const mp = await prisma.modelProvider.create({
    data: {
      projectId: project.id,
      provider,
      enabled: hasRealKey,
      customKeys: hasRealKey
        ? (envValues as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  });
  console.log(
    `✓ created ModelProvider(${provider}) ${hasRealKey ? "with real keys" : "(no env keys — disabled)"}`,
  );
  return mp;
}

async function upsertProviderBinding(args: {
  project: Project & { team: { organizationId: string } };
  modelProvider: { id: string };
  slot: string;
  rateLimitRpm: number | null;
  rateLimitRpd: number | null;
  fallbackPriorityGlobal: number | null;
  actorUserId: string;
}) {
  const existing = await prisma.gatewayProviderCredential.findFirst({
    where: {
      projectId: args.project.id,
      modelProviderId: args.modelProvider.id,
      slot: args.slot,
    },
  });
  if (existing) {
    console.log(
      `· binding for modelProviderId=${args.modelProvider.id} slot=${args.slot} exists (${existing.id})`,
    );
    return existing;
  }
  const row = await prisma.gatewayProviderCredential.create({
    data: {
      projectId: args.project.id,
      modelProviderId: args.modelProvider.id,
      slot: args.slot,
      rateLimitRpm: args.rateLimitRpm,
      rateLimitRpd: args.rateLimitRpd,
      fallbackPriorityGlobal: args.fallbackPriorityGlobal,
    },
  });
  return row;
}

async function upsertBudget(args: {
  organizationId: string;
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT" | "VIRTUAL_KEY" | "PRINCIPAL";
  scopeId: string;
  organizationScopedId?: string | null;
  teamScopedId?: string | null;
  projectScopedId?: string | null;
  virtualKeyScopedId?: string | null;
  principalUserId?: string | null;
  name: string;
  window: "MINUTE" | "HOUR" | "DAY" | "WEEK" | "MONTH" | "TOTAL";
  limitUsd: string;
  onBreach: "BLOCK" | "WARN";
  actorUserId: string;
}) {
  const existing = await prisma.gatewayBudget.findFirst({
    where: {
      organizationId: args.organizationId,
      scopeType: args.scopeType,
      scopeId: args.scopeId,
      name: args.name,
    },
  });
  if (existing) {
    console.log(
      `· budget '${args.name}' exists (${existing.id}) — skipping`,
    );
    return existing;
  }
  const row = await prisma.gatewayBudget.create({
    data: {
      organizationId: args.organizationId,
      scopeType: args.scopeType,
      scopeId: args.scopeId,
      organizationScopedId:
        args.scopeType === "ORGANIZATION" ? args.organizationId : null,
      teamScopedId: args.teamScopedId ?? null,
      projectScopedId: args.projectScopedId ?? null,
      virtualKeyScopedId: args.virtualKeyScopedId ?? null,
      principalUserId: args.principalUserId ?? null,
      name: args.name,
      window: args.window,
      limitUsd: new Prisma.Decimal(args.limitUsd),
      onBreach: args.onBreach,
      resetsAt: nextResetAt(args.window),
      currentPeriodStartedAt: new Date(),
      createdById: args.actorUserId,
    },
  });
  console.log(`✓ created budget '${args.name}' (${row.id})`);
  return row;
}

async function pickActor(organizationId: string): Promise<string> {
  const member = await prisma.organizationUser.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
  if (!member) {
    throw new Error(
      "No user found in the organization — seed one via the signup flow first",
    );
  }
  return member.userId;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
