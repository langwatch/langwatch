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

  // VK #1: prod-openai — blocked_patterns + rate limits + tags
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
      metadata: { tags: ["tier=enterprise", "env=prod", "owner=platform"] },
    },
    actorUserId,
  });

  // VK #2: prod-claude — just Anthropic, lower rate limits + aliases
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
        fast: "claude-haiku-4-5-20251001",
      },
      metadata: { tags: ["tier=free", "env=prod"] },
    },
    actorUserId,
  });

  // VK #3: eval-suite — used by internal eval jobs, cache-disabled via rule
  const evalSuiteSecret = await upsertVirtualKey({
    project,
    name: "eval-suite",
    description:
      "Offline eval runs — cache disabled via 'disable-cache-evals' rule for reproducibility",
    environment: "LIVE",
    providerChain: [openaiBinding.id],
    config: {
      ...defaultVirtualKeyConfig(),
      cache: { mode: "disable", ttlS: 0 },
      rateLimits: { rpm: 200, tpm: null, rpd: 20_000 },
      metadata: { tags: ["suite=evals", "env=internal"] },
    },
    actorUserId,
  });

  // VK #4: mobile-app — TEST environment, tight caps
  const mobileAppSecret = await upsertVirtualKey({
    project,
    name: "mobile-app-test",
    description:
      "Mobile app test key — TEST environment, 10k rpd cap, Anthropic-first fallback",
    environment: "TEST",
    providerChain: [anthropicBinding.id],
    config: {
      ...defaultVirtualKeyConfig(),
      rateLimits: { rpm: 30, tpm: null, rpd: 10_000 },
      metadata: { tags: ["surface=mobile", "env=test"] },
    },
    actorUserId,
  });

  // VK #5: dev-sandbox — revoked, demonstrates red status badge
  const devSandboxSecret = await upsertVirtualKey({
    project,
    name: "dev-sandbox-legacy",
    description: "Retired dev key — revoked Nov 2025 after rotation",
    environment: "TEST",
    providerChain: [openaiBinding.id],
    config: {
      ...defaultVirtualKeyConfig(),
      metadata: { tags: ["env=dev", "status=deprecated"] },
    },
    actorUserId,
    postMintStatus: "REVOKED",
  });

  // Budgets — five scopes covering enum + varied spent% so progress
  // bars render red/orange/green in the list. Ledger entries below
  // drive Spent$ via real debit rows (mirror-source-of-truth).
  const orgMonthly = await upsertBudget({
    organizationId: project.team.organizationId,
    scopeType: "ORGANIZATION",
    scopeId: project.team.organizationId,
    organizationScopedId: project.team.organizationId,
    name: "Org monthly",
    window: "MONTH",
    limitUsd: "5000",
    spentUsd: "1247.35",
    onBreach: "WARN",
    actorUserId,
  });
  const projectDaily = await upsertBudget({
    organizationId: project.team.organizationId,
    scopeType: "PROJECT",
    scopeId: project.id,
    projectScopedId: project.id,
    name: "Project daily",
    window: "DAY",
    limitUsd: "200",
    spentUsd: "183.92",
    onBreach: "BLOCK",
    actorUserId,
  });
  const teamWeekly = await upsertBudget({
    organizationId: project.team.organizationId,
    scopeType: "TEAM",
    scopeId: project.teamId,
    teamScopedId: project.teamId,
    name: "Team weekly (platform)",
    window: "WEEK",
    limitUsd: "800",
    spentUsd: "412.60",
    onBreach: "WARN",
    actorUserId,
  });
  let vkBudget:
    | Awaited<ReturnType<typeof upsertBudget>>
    | undefined;
  if (prodOpenaiSecret.vkId) {
    vkBudget = await upsertBudget({
      organizationId: project.team.organizationId,
      scopeType: "VIRTUAL_KEY",
      scopeId: prodOpenaiSecret.vkId,
      virtualKeyScopedId: prodOpenaiSecret.vkId,
      name: "prod-openai daily cap",
      window: "DAY",
      limitUsd: "50",
      spentUsd: "52.18",
      onBreach: "BLOCK",
      actorUserId,
    });
  }
  if (mobileAppSecret.vkId) {
    await upsertBudget({
      organizationId: project.team.organizationId,
      scopeType: "VIRTUAL_KEY",
      scopeId: mobileAppSecret.vkId,
      virtualKeyScopedId: mobileAppSecret.vkId,
      name: "mobile-app hourly",
      window: "HOUR",
      limitUsd: "5",
      spentUsd: "0.74",
      onBreach: "BLOCK",
      actorUserId,
    });
  }

  // Sync VK.lastUsedAt against the ledger debits we're about to seed
  // — surfaces realistic relative-time badges on the VK list, rather
  // than "never" for every key even when there are 378 debits in the
  // ledger. Mirrors what the gateway audit log debit path will do
  // post-request in production.
  const lastUsedMap: Record<string, number> = {
    [prodOpenaiSecret.vkId]: Date.now() - 12 * 60 * 1000, // 12 min ago
    [prodClaudeSecret.vkId]: Date.now() - 3 * 60 * 60 * 1000, // 3h ago
    [evalSuiteSecret.vkId]: Date.now() - 26 * 60 * 60 * 1000, // ~1 day ago
    [mobileAppSecret.vkId]: Date.now() - 4 * 24 * 60 * 60 * 1000, // 4 days
    // dev-sandbox-legacy deliberately left null — it's revoked
  };
  for (const [vkId, ts] of Object.entries(lastUsedMap)) {
    await prisma.virtualKey.update({
      where: { id: vkId },
      data: { lastUsedAt: new Date(ts) },
    });
  }
  console.log(`✓ backfilled VK.lastUsedAt on ${Object.keys(lastUsedMap).length} keys`);

  // Ledger debits — drive byDay sparkline on Usage page + detail page
  // recent-debits panel. Spread across 30 days with weekday bias so
  // the chart shows weekly cadence. Models + providerSlots varied so
  // the by-model breakdown has texture.
  await seedLedger({
    budget: orgMonthly,
    virtualKeyId: prodOpenaiSecret.vkId,
    providerCredentialId: openaiBinding.id,
    dayCount: 30,
    dailyMean: 41.58,
    model: "gpt-5-mini",
    providerSlot: "primary",
  });
  await seedLedger({
    budget: projectDaily,
    virtualKeyId: prodClaudeSecret.vkId,
    providerCredentialId: anthropicBinding.id,
    dayCount: 1,
    dailyMean: 183.92,
    model: "claude-haiku-4-5-20251001",
    providerSlot: "primary",
  });
  await seedLedger({
    budget: teamWeekly,
    virtualKeyId: evalSuiteSecret.vkId,
    providerCredentialId: openaiBinding.id,
    dayCount: 7,
    dailyMean: 58.94,
    model: "gpt-5-mini",
    providerSlot: "primary",
  });
  if (vkBudget && prodOpenaiSecret.vkId) {
    await seedLedger({
      budget: vkBudget,
      virtualKeyId: prodOpenaiSecret.vkId,
      providerCredentialId: openaiBinding.id,
      dayCount: 1,
      dailyMean: 52.18,
      model: "gpt-5-mini",
      providerSlot: "primary",
    });
  }

  // Cache rules — three priorities exercising the three action modes.
  // Priority DESC order demonstrates first-match-wins clearly in the UI.
  const forceCacheRule = await upsertCacheRule({
    organizationId: project.team.organizationId,
    name: "force-cache-enterprise",
    description:
      "Force cache on Anthropic for enterprise-tagged VKs to reduce cold-start TTFT",
    priority: 300,
    matchers: { vk_tags: ["tier=enterprise"] },
    action: { mode: "force", ttl: 600 },
    modeEnum: "FORCE",
    actorUserId,
  });
  const disableCacheRule = await upsertCacheRule({
    organizationId: project.team.organizationId,
    name: "disable-cache-evals",
    description:
      "Disable cache for evaluation traffic so every eval hits a fresh completion",
    priority: 200,
    matchers: {
      vk_prefix: "lw_vk_eval_",
      request_metadata: { "x-langwatch-suite": "evals" },
    },
    action: { mode: "disable" },
    modeEnum: "DISABLE",
    actorUserId,
  });
  const respectCacheRule = await upsertCacheRule({
    organizationId: project.team.organizationId,
    name: "respect-on-haiku",
    description:
      "Default passthrough for Anthropic Haiku — demonstrates respect mode in the list",
    priority: 100,
    matchers: { model: "claude-haiku-4-5-20251001" },
    action: { mode: "respect" },
    modeEnum: "RESPECT",
    actorUserId,
  });

  // Audit log — replay the history that would have accumulated if
  // each of the above resources had been created through the UI.
  await seedAuditLog({
    organizationId: project.team.organizationId,
    projectId: project.id,
    actorUserId,
    virtualKeys: [
      { id: prodOpenaiSecret.vkId, name: "prod-openai" },
      { id: prodClaudeSecret.vkId, name: "prod-claude" },
      { id: evalSuiteSecret.vkId, name: "eval-suite" },
      { id: mobileAppSecret.vkId, name: "mobile-app-test" },
      { id: devSandboxSecret.vkId, name: "dev-sandbox-legacy" },
    ],
    budgets: [
      { id: orgMonthly.id, name: "Org monthly" },
      { id: projectDaily.id, name: "Project daily" },
      { id: teamWeekly.id, name: "Team weekly (platform)" },
    ],
    cacheRules: [
      { id: forceCacheRule.id, name: "force-cache-enterprise" },
      { id: disableCacheRule.id, name: "disable-cache-evals" },
      { id: respectCacheRule.id, name: "respect-on-haiku" },
    ],
    providerBindings: [
      { id: openaiBinding.id, slot: "primary" },
      { id: anthropicBinding.id, slot: "fallback-1" },
    ],
  });

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  VK SECRETS — capture NOW, we don't store the raw secret.    ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  prod-openai         (id=${prodOpenaiSecret.vkId})`);
  console.log(`║      secret: ${prodOpenaiSecret.secret}`);
  console.log(`║  prod-claude         (id=${prodClaudeSecret.vkId})`);
  console.log(`║      secret: ${prodClaudeSecret.secret}`);
  console.log(`║  eval-suite          (id=${evalSuiteSecret.vkId})`);
  console.log(`║      secret: ${evalSuiteSecret.secret}`);
  console.log(`║  mobile-app-test     (id=${mobileAppSecret.vkId})`);
  console.log(`║      secret: ${mobileAppSecret.secret}`);
  console.log(`║  dev-sandbox-legacy  (id=${devSandboxSecret.vkId}) [REVOKED]`);
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
  postMintStatus?: "ACTIVE" | "REVOKED";
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
        status: input.postMintStatus === "REVOKED" ? "REVOKED" : "ACTIVE",
        revokedAt: input.postMintStatus === "REVOKED" ? new Date() : null,
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
  const hasRealKey = Object.values(envValues).some((v) => !!v);
  const existing = await prisma.modelProvider.findFirst({
    where: { projectId: project.id, provider },
  });
  if (existing) {
    // A previous seed run created this row with no env keys (disabled,
    // customKeys=null). If the env now has real keys, patch it so
    // dogfood users who only recently exported their OPENAI_API_KEY
    // don't have to wipe + reseed just to wire provider credentials.
    const hasExistingKeys =
      existing.customKeys && typeof existing.customKeys === "object";
    if (!hasExistingKeys && hasRealKey) {
      await prisma.modelProvider.update({
        where: { id: existing.id },
        data: {
          enabled: true,
          customKeys: envValues as Prisma.InputJsonValue,
        },
      });
      console.log(
        `✓ patched ModelProvider(${provider}) with env-derived keys (${existing.id})`,
      );
      return { ...existing, enabled: true };
    }
    console.log(`· ModelProvider(${provider}) exists (${existing.id})`);
    return existing;
  }
  const mp = await prisma.modelProvider.create({
    data: {
      projectId: project.id,
      scopeType: "PROJECT",
      scopeId: project.id,
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
  spentUsd?: string;
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
      spentUsd: args.spentUsd ? new Prisma.Decimal(args.spentUsd) : new Prisma.Decimal(0),
      onBreach: args.onBreach,
      resetsAt: nextResetAt(args.window),
      currentPeriodStartedAt: new Date(),
      createdById: args.actorUserId,
    },
  });
  console.log(`✓ created budget '${args.name}' (${row.id})`);
  return row;
}

async function seedLedger(args: {
  budget: { id: string };
  virtualKeyId: string;
  providerCredentialId: string;
  dayCount: number;
  dailyMean: number;
  model: string;
  providerSlot: string;
}) {
  const now = Date.now();
  const rows: Prisma.GatewayBudgetLedgerCreateManyInput[] = [];
  for (let d = 0; d < args.dayCount; d++) {
    const dayStart = now - d * 24 * 60 * 60 * 1000;
    // Requests per day: 8-18, skewed by weekday factor for texture.
    const weekday = new Date(dayStart).getUTCDay();
    const weekdayFactor = weekday === 0 || weekday === 6 ? 0.4 : 1.0;
    const requests = Math.max(3, Math.round((8 + Math.random() * 10) * weekdayFactor));
    const meanAmount = (args.dailyMean * weekdayFactor) / requests;
    for (let i = 0; i < requests; i++) {
      const occurredAt = new Date(dayStart - Math.floor(Math.random() * 12 * 60 * 60 * 1000));
      const amount = meanAmount * (0.5 + Math.random());
      const tokensInput = 200 + Math.floor(Math.random() * 2000);
      const tokensOutput = 100 + Math.floor(Math.random() * 1500);
      rows.push({
        budgetId: args.budget.id,
        virtualKeyId: args.virtualKeyId,
        providerCredentialId: args.providerCredentialId,
        gatewayRequestId: `seed_${now}_${d}_${i}_${Math.random().toString(36).slice(2, 8)}`,
        amountUsd: new Prisma.Decimal(amount.toFixed(6)),
        tokensInput,
        tokensOutput,
        tokensCacheRead: Math.random() > 0.7 ? Math.floor(tokensInput * 0.6) : 0,
        tokensCacheWrite: Math.random() > 0.85 ? Math.floor(tokensInput * 0.3) : 0,
        model: args.model,
        providerSlot: args.providerSlot,
        durationMs: 150 + Math.floor(Math.random() * 1800),
        status: Math.random() > 0.95 ? "PROVIDER_ERROR" : "SUCCESS",
        occurredAt,
      });
    }
  }
  // Skip-duplicates so re-runs are idempotent on the idempotency key.
  const result = await prisma.gatewayBudgetLedger.createMany({
    data: rows,
    skipDuplicates: true,
  });
  console.log(
    `✓ seeded ledger: ${result.count} debits across ${args.dayCount}d for budget=${args.budget.id}`,
  );
}

async function seedAuditLog(args: {
  organizationId: string;
  projectId: string;
  actorUserId: string;
  virtualKeys: Array<{ id: string; name: string }>;
  budgets: Array<{ id: string; name: string }>;
  cacheRules: Array<{ id: string; name: string }>;
  providerBindings: Array<{ id: string; slot: string }>;
}) {
  // Idempotency guard: GatewayAuditLog has no natural unique key
  // (PK=nanoid, no composite constraint on target + action + day), so
  // a second run of this seed would pile on synthetic VIRTUAL_KEY_CREATED
  // rows and make the Audit page show two (or more) 'created' events per
  // VK. @ariana finding #10. If the first seeded VK already has any
  // audit rows attached, assume the full replay ran before and skip.
  const firstVkId = args.virtualKeys[0]?.id;
  if (firstVkId) {
    const alreadySeeded = await prisma.gatewayAuditLog.count({
      where: {
        organizationId: args.organizationId,
        targetKind: "virtual_key",
        targetId: firstVkId,
        action: "VIRTUAL_KEY_CREATED",
      },
    });
    if (alreadySeeded > 0) {
      console.log(
        "· audit log already seeded (found VIRTUAL_KEY_CREATED for first VK) — skipping replay",
      );
      return;
    }
  }
  const events: Prisma.GatewayAuditLogCreateManyInput[] = [];
  const now = Date.now();
  const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000);

  args.virtualKeys.forEach((vk, i) => {
    events.push({
      organizationId: args.organizationId,
      projectId: args.projectId,
      actorUserId: args.actorUserId,
      action: "VIRTUAL_KEY_CREATED",
      targetKind: "virtual_key",
      targetId: vk.id,
      before: Prisma.JsonNull,
      after: { name: vk.name } as Prisma.InputJsonValue,
      createdAt: daysAgo(14 - i),
    });
  });
  // One update event per VK — swaps a rate-limit
  events.push({
    organizationId: args.organizationId,
    projectId: args.projectId,
    actorUserId: args.actorUserId,
    action: "VIRTUAL_KEY_UPDATED",
    targetKind: "virtual_key",
    targetId: args.virtualKeys[0]?.id ?? "vk_unknown",
    before: { rateLimits: { rpm: 300 } } as Prisma.InputJsonValue,
    after: { rateLimits: { rpm: 500 } } as Prisma.InputJsonValue,
    createdAt: daysAgo(5),
  });
  events.push({
    organizationId: args.organizationId,
    projectId: args.projectId,
    actorUserId: args.actorUserId,
    action: "VIRTUAL_KEY_ROTATED",
    targetKind: "virtual_key",
    targetId: args.virtualKeys[1]?.id ?? "vk_unknown",
    before: { displayPrefix: "lw_vk_a1b2c3" } as Prisma.InputJsonValue,
    after: { displayPrefix: "lw_vk_f7e8d9" } as Prisma.InputJsonValue,
    createdAt: daysAgo(3),
  });
  // Revoke event for the sandbox
  const revoked = args.virtualKeys.find((v) => v.name === "dev-sandbox-legacy");
  if (revoked) {
    events.push({
      organizationId: args.organizationId,
      projectId: args.projectId,
      actorUserId: args.actorUserId,
      action: "VIRTUAL_KEY_REVOKED",
      targetKind: "virtual_key",
      targetId: revoked.id,
      before: { status: "ACTIVE" } as Prisma.InputJsonValue,
      after: { status: "REVOKED" } as Prisma.InputJsonValue,
      createdAt: daysAgo(1),
    });
  }
  args.budgets.forEach((b, i) => {
    events.push({
      organizationId: args.organizationId,
      projectId: args.projectId,
      actorUserId: args.actorUserId,
      action: "BUDGET_CREATED",
      targetKind: "budget",
      targetId: b.id,
      before: Prisma.JsonNull,
      after: { name: b.name } as Prisma.InputJsonValue,
      createdAt: daysAgo(10 - i),
    });
  });
  // One budget limit raise
  if (args.budgets[0]) {
    events.push({
      organizationId: args.organizationId,
      projectId: args.projectId,
      actorUserId: args.actorUserId,
      action: "BUDGET_UPDATED",
      targetKind: "budget",
      targetId: args.budgets[0].id,
      before: { limitUsd: "3000", onBreach: "WARN" } as Prisma.InputJsonValue,
      after: { limitUsd: "5000", onBreach: "WARN" } as Prisma.InputJsonValue,
      createdAt: daysAgo(2),
    });
  }
  args.providerBindings.forEach((pb, i) => {
    events.push({
      organizationId: args.organizationId,
      projectId: args.projectId,
      actorUserId: args.actorUserId,
      action: "PROVIDER_BINDING_CREATED",
      targetKind: "provider_binding",
      targetId: pb.id,
      before: Prisma.JsonNull,
      after: { slot: pb.slot } as Prisma.InputJsonValue,
      createdAt: daysAgo(20 - i),
    });
  });
  args.cacheRules.forEach((cr, i) => {
    events.push({
      organizationId: args.organizationId,
      projectId: args.projectId,
      actorUserId: args.actorUserId,
      action: "CACHE_RULE_CREATED",
      targetKind: "cache_rule",
      targetId: cr.id,
      before: Prisma.JsonNull,
      after: { name: cr.name } as Prisma.InputJsonValue,
      createdAt: daysAgo(7 - i),
    });
  });
  if (args.cacheRules[0]) {
    events.push({
      organizationId: args.organizationId,
      projectId: args.projectId,
      actorUserId: args.actorUserId,
      action: "CACHE_RULE_UPDATED",
      targetKind: "cache_rule",
      targetId: args.cacheRules[0].id,
      before: { priority: 200, "action.ttl": 300 } as Prisma.InputJsonValue,
      after: { priority: 300, "action.ttl": 600 } as Prisma.InputJsonValue,
      createdAt: daysAgo(0.5),
    });
  }

  const result = await prisma.gatewayAuditLog.createMany({
    data: events,
    skipDuplicates: true,
  });
  console.log(`✓ seeded audit log: ${result.count} events`);
}

async function upsertCacheRule(args: {
  organizationId: string;
  name: string;
  description: string;
  priority: number;
  matchers: Record<string, unknown>;
  action: { mode: "respect" | "force" | "disable"; ttl?: number; salt?: string };
  modeEnum: "RESPECT" | "FORCE" | "DISABLE";
  actorUserId: string;
}) {
  const existing = await prisma.gatewayCacheRule.findFirst({
    where: {
      organizationId: args.organizationId,
      name: args.name,
      archivedAt: null,
    },
  });
  if (existing) {
    console.log(
      `· cache rule '${args.name}' exists (${existing.id}) — skipping`,
    );
    return existing;
  }
  const row = await prisma.gatewayCacheRule.create({
    data: {
      organizationId: args.organizationId,
      name: args.name,
      description: args.description,
      priority: args.priority,
      enabled: true,
      matchers: args.matchers as Prisma.InputJsonValue,
      action: args.action as unknown as Prisma.InputJsonValue,
      modeEnum: args.modeEnum,
      createdById: args.actorUserId,
    },
  });
  console.log(`✓ created cache rule '${args.name}' (${row.id})`);
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
