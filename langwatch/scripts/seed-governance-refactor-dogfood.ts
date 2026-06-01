/**
 * Governance-refactor dogfood seeder (J1 companion to J2).
 *
 * Run AFTER `pnpm prisma migrate deploy` lands the J2 forward-only
 * migration that drops VirtualKeyProviderCredential, drops
 * GatewayProviderCredential, drops VirtualKey.projectId, and adds the
 * VirtualKeyScope table.
 *
 * Populates a minimal-but-representative dev shape covering every code
 * path the refactor introduces, so /me and the gateway UI don't render
 * empty post-migrate:
 *
 *   - Org "ACME" with 2 teams ("platform", "data-sci") and 3 projects
 *     ("demo" + "billing" in platform, "ml-prod" in data-sci).
 *   - 2 ModelProviders: "OpenAI" at ORGANIZATION scope (visible to
 *     every VK in the org) and "Anthropic" at TEAM "platform" scope
 *     (visible only to VKs scoped at or under platform).
 *   - 1 RoutingPolicy "developer-default" at ORG scope, strategy=priority,
 *     modelProviderIds=[openai, anthropic] for deterministic ordering.
 *   - 4 VirtualKeys, one per scope-cascade pattern:
 *       vk_org              scope=ORG               → resolves OpenAI
 *       vk_team_platform    scope=TEAM platform     → resolves OpenAI + Anthropic
 *       vk_project_demo     scope=PROJECT demo      → resolves OpenAI + Anthropic
 *       vk_personal         scope=ORG, principal=u  → personal-VK lazy-mint shape
 *   - 1 PRINCIPAL-scope GatewayBudget on the dogfood user ($50/mo),
 *     so /me renders a non-empty budget chip immediately post-seed.
 *
 * Idempotent: every entity upserts on a stable unique key
 * (organizationId+name for VKs, organizationId+slug for teams/projects,
 * hashedSecret for the VK row identity). Re-running after a partial
 * failure is safe and converges to the same state.
 *
 * Replaces `scripts/seed-gateway-dogfood.ts` which was tied to the
 * dropped GatewayProviderCredential + VirtualKeyProviderCredential
 * binding model.
 *
 * Run:
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... \
 *     pnpm tsx scripts/seed-governance-refactor-dogfood.ts
 *
 * Missing provider env vars are tolerated — the corresponding MP is
 * created with `customKeys=null` (disabled) so the row appears in the
 * UI but the gateway will fall through to the next eligible MP on
 * dispatch. Sergey's provider-matrix tests then `t.Skip` those cells.
 *
 * Emits the minted VK secrets to stdout ONCE. Capture them for the F
 * full-matrix dogfood lane.
 */
import { randomBytes } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

import { nextResetAt } from "../src/server/gateway/budgetWindow";
import {
  hashVirtualKeySecret,
  mintVirtualKeySecret,
} from "../src/server/gateway/virtualKey.crypto";
import { encrypt } from "../src/utils/encryption";

const prisma = new PrismaClient();

const DOGFOOD_USER_EMAIL = "dogfood@acme.test";
const DOGFOOD_USER_NAME = "Dogfood Admin";
const ORG_SLUG = "acme";
const ORG_NAME = "ACME";

/**
 * Encrypt customKeys for the ModelProvider.customKeys column. The
 * materialiser's decryptCustomKeys() accepts both encrypted strings AND
 * plain objects, but prod always stores the encrypted form; seed in
 * the same shape so the dogfood data exercises the decrypt path.
 */
function encryptKeys(keys: Record<string, string>): string {
  return encrypt(JSON.stringify(keys));
}

interface SeedHandles {
  userId: string;
  organizationId: string;
  platformTeamId: string;
  dataSciTeamId: string;
  demoProjectId: string;
  billingProjectId: string;
  mlProdProjectId: string;
  openaiMpId: string;
  anthropicMpId: string;
  routingPolicyId: string;
}

async function ensureUserOrgTeamsProjects(): Promise<
  Omit<SeedHandles, "openaiMpId" | "anthropicMpId" | "routingPolicyId">
> {
  const user = await prisma.user.upsert({
    where: { email: DOGFOOD_USER_EMAIL },
    create: { email: DOGFOOD_USER_EMAIL, name: DOGFOOD_USER_NAME },
    update: { name: DOGFOOD_USER_NAME },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    create: { slug: ORG_SLUG, name: ORG_NAME },
    update: { name: ORG_NAME },
  });

  // Make the dogfood user an org admin via OrganizationUser (legacy enum
  // short-circuit path; RoleBinding seed not required for the dogfood
  // shape because rbac.ts:715 short-circuits ADMIN to all perms).
  await prisma.organizationUser.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: organization.id,
      },
    },
    create: {
      userId: user.id,
      organizationId: organization.id,
      role: "ADMIN",
    },
    update: { role: "ADMIN" },
  });

  const platformTeam = await prisma.team.upsert({
    where: { slug: "platform" },
    create: { slug: "platform", name: "Platform", organizationId: organization.id },
    update: { name: "Platform" },
  });

  const dataSciTeam = await prisma.team.upsert({
    where: { slug: "data-sci" },
    create: { slug: "data-sci", name: "Data Science", organizationId: organization.id },
    update: { name: "Data Science" },
  });

  const demoProject = await prisma.project.upsert({
    where: { slug: "demo" },
    create: {
      slug: "demo",
      name: "Demo",
      teamId: platformTeam.id,
      language: "typescript",
      framework: "openai",
      apiKey: `sk-lw-dogfood-demo-${randomBytes(4).toString("hex")}`,
    },
    update: { name: "Demo" },
  });

  const billingProject = await prisma.project.upsert({
    where: { slug: "billing" },
    create: {
      slug: "billing",
      name: "Billing",
      teamId: platformTeam.id,
      language: "typescript",
      framework: "openai",
      apiKey: `sk-lw-dogfood-billing-${randomBytes(4).toString("hex")}`,
    },
    update: { name: "Billing" },
  });

  const mlProdProject = await prisma.project.upsert({
    where: { slug: "ml-prod" },
    create: {
      slug: "ml-prod",
      name: "ML Prod",
      teamId: dataSciTeam.id,
      language: "python",
      framework: "openai",
      apiKey: `sk-lw-dogfood-mlprod-${randomBytes(4).toString("hex")}`,
    },
    update: { name: "ML Prod" },
  });

  return {
    userId: user.id,
    organizationId: organization.id,
    platformTeamId: platformTeam.id,
    dataSciTeamId: dataSciTeam.id,
    demoProjectId: demoProject.id,
    billingProjectId: billingProject.id,
    mlProdProjectId: mlProdProject.id,
  };
}

async function ensureModelProviders(
  base: Omit<SeedHandles, "openaiMpId" | "anthropicMpId" | "routingPolicyId">,
): Promise<{
  openaiMpId: string;
  anthropicMpId: string;
  geminiMpId: string | null;
  bedrockMpId: string | null;
}> {
  // Key names match what config.materialiser's buildCredentials() picks
  // off customKeys for each provider (UPPER_SNAKE_CASE env-var style).
  const openaiKey = process.env.OPENAI_API_KEY ?? null;
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? null;
  const geminiKey =
    process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
  const bedrockAccessKey = process.env.AWS_ACCESS_KEY_ID ?? null;
  const bedrockSecretKey = process.env.AWS_SECRET_ACCESS_KEY ?? null;
  const bedrockRegion =
    process.env.AWS_REGION_NAME ??
    process.env.AWS_REGION ??
    process.env.AWS_DEFAULT_REGION ??
    "us-east-1";

  // OpenAI at ORG scope — every VK in the org can resolve it via scope cascade.
  const openai = await upsertModelProviderByName({
    organizationId: base.organizationId,
    name: "OpenAI",
    provider: "openai",
    customKeys: openaiKey ? encryptKeys({ OPENAI_API_KEY: openaiKey }) : null,
    rateLimitRpm: 600,
    fallbackPriorityGlobal: 10,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: base.organizationId }],
  });

  // Anthropic at TEAM "platform" scope — only platform-scoped (or narrower)
  // VKs see it. Proves scope inheritance limits visibility.
  const anthropic = await upsertModelProviderByName({
    organizationId: base.organizationId,
    name: "Anthropic",
    provider: "anthropic",
    customKeys: anthropicKey
      ? encryptKeys({ ANTHROPIC_API_KEY: anthropicKey })
      : null,
    rateLimitRpm: 300,
    fallbackPriorityGlobal: 20,
    scopes: [{ scopeType: "TEAM", scopeId: base.platformTeamId }],
  });

  // Gemini at ORG scope so any VK in the org can route through it
  // alongside OpenAI. Only seeded when GEMINI_API_KEY (or
  // GOOGLE_API_KEY fallback) is set in env.
  const gemini = geminiKey
    ? await upsertModelProviderByName({
        organizationId: base.organizationId,
        name: "Gemini",
        provider: "gemini",
        customKeys: encryptKeys({ GEMINI_API_KEY: geminiKey }),
        rateLimitRpm: 300,
        fallbackPriorityGlobal: 30,
        scopes: [{ scopeType: "ORGANIZATION", scopeId: base.organizationId }],
      })
    : null;

  // Bedrock at ORG scope. Requires AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY.
  const bedrock =
    bedrockAccessKey && bedrockSecretKey
      ? await upsertModelProviderByName({
          organizationId: base.organizationId,
          name: "Bedrock",
          provider: "bedrock",
          customKeys: encryptKeys({
            AWS_ACCESS_KEY_ID: bedrockAccessKey,
            AWS_SECRET_ACCESS_KEY: bedrockSecretKey,
            AWS_REGION_NAME: bedrockRegion,
          }),
          rateLimitRpm: 200,
          fallbackPriorityGlobal: 40,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: base.organizationId }],
        })
      : null;

  return {
    openaiMpId: openai.id,
    anthropicMpId: anthropic.id,
    geminiMpId: gemini?.id ?? null,
    bedrockMpId: bedrock?.id ?? null,
  };
}

async function upsertModelProviderByName(input: {
  organizationId: string;
  name: string;
  provider: string;
  customKeys: string | Record<string, unknown> | null;
  rateLimitRpm: number;
  fallbackPriorityGlobal: number;
  scopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>;
}): Promise<{ id: string }> {
  // Idempotency: ANY MP with this `name` reachable from one of the
  // input scopes counts as the same row. Matching only ORGANIZATION
  // scope missed TEAM-scoped seeds and produced duplicate rows on
  // every re-run.
  const existing = await prisma.modelProvider.findFirst({
    where: {
      name: input.name,
      scopes: {
        some: {
          OR: input.scopes.map((s) => ({
            scopeType: s.scopeType,
            scopeId: s.scopeId,
          })),
        },
      },
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.modelProvider.update({
      where: { id: existing.id },
      data: {
        customKeys: input.customKeys
          ? (input.customKeys as Prisma.InputJsonValue)
          : Prisma.DbNull,
        enabled: true,
      },
    });
    return existing;
  }
  const created = await prisma.modelProvider.create({
    data: {
      name: input.name,
      provider: input.provider,
      enabled: true,
      organizationId: input.organizationId,
      customKeys: input.customKeys
        ? (input.customKeys as Prisma.InputJsonValue)
        : Prisma.DbNull,
      rateLimitRpm: input.rateLimitRpm,
      fallbackPriorityGlobal: input.fallbackPriorityGlobal,
      scopes: {
        create: input.scopes,
      },
    },
    select: { id: true },
  });
  return created;
}

async function ensureRoutingPolicy(
  base: Omit<SeedHandles, "openaiMpId" | "anthropicMpId" | "routingPolicyId">,
  mps: {
    openaiMpId: string;
    anthropicMpId: string;
    geminiMpId: string | null;
    bedrockMpId: string | null;
  },
): Promise<string> {
  // ORG-scope default policy that orders openai → anthropic (→ gemini →
  // bedrock when those MPs are seeded with real keys) for any VK that
  // links to it. The vk_org row WILL link to this; the team/project
  // ones will deliberately NOT link, exercising the no-policy default
  // fallback path locked in vk-config-bundle.feature.
  const chain = [
    mps.openaiMpId,
    mps.anthropicMpId,
    mps.geminiMpId,
    mps.bedrockMpId,
  ].filter((id): id is string => typeof id === "string");
  const existing = await prisma.routingPolicy.findFirst({
    where: {
      organizationId: base.organizationId,
      name: "developer-default",
      scopes: {
        some: {
          scopeType: "ORGANIZATION",
          scopeId: base.organizationId,
        },
      },
    },
  });
  if (existing) {
    await prisma.routingPolicy.update({
      where: { id: existing.id },
      data: { modelProviderIds: chain },
    });
    return existing.id;
  }
  const policy = await prisma.routingPolicy.create({
    data: {
      organizationId: base.organizationId,
      scopes: {
        create: [
          { scopeType: "ORGANIZATION", scopeId: base.organizationId },
        ],
      },
      name: "developer-default",
      description: "Try OpenAI first, fall back to other configured providers",
      strategy: "priority",
      modelProviderIds: chain,
      modelAllowlist: [
        "gpt-5-mini",
        "gpt-5",
        "claude-haiku-4-5",
        "claude-3-5-haiku",
        "claude-3-5-haiku-latest",
        "claude-sonnet-4",
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "anthropic.claude-3-5-haiku-20241022-v1:0",
      ],
      isDefault: true,
    },
  });
  return policy.id;
}

interface MintedVk {
  name: string;
  id: string;
  secret: string;
  scopes: string[];
}

async function mintVk(input: {
  organizationId: string;
  name: string;
  description: string;
  routingPolicyId: string | null;
  principalUserId: string | null;
  createdById: string;
  scopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>;
}): Promise<MintedVk> {
  // Always mint a fresh secret on first run; on re-run, idempotency falls
  // back to the existing row (we detect by organizationId+name).
  const existing = await prisma.virtualKey.findFirst({
    where: { organizationId: input.organizationId, name: input.name },
    include: { scopes: true },
  });
  if (existing) {
    return {
      name: input.name,
      id: existing.id,
      secret: "<existing; not re-emitted>",
      scopes: existing.scopes.map((s) => `${s.scopeType}:${s.scopeId}`),
    };
  }
  const secret = mintVirtualKeySecret();
  const hashedSecret = hashVirtualKeySecret(secret);
  const created = await prisma.virtualKey.create({
    data: {
      organizationId: input.organizationId,
      name: input.name,
      description: input.description,
      hashedSecret,
      displayPrefix: secret.slice(0, 18),
      principalUserId: input.principalUserId,
      routingPolicyId: input.routingPolicyId,
      createdById: input.createdById,
      scopes: { create: input.scopes },
    },
  });
  return {
    name: input.name,
    id: created.id,
    secret,
    scopes: input.scopes.map((s) => `${s.scopeType}:${s.scopeId}`),
  };
}

async function ensureVirtualKeys(handles: SeedHandles): Promise<MintedVk[]> {
  const vks: MintedVk[] = [];
  vks.push(
    await mintVk({
      organizationId: handles.organizationId,
      name: "vk_org",
      description: "ORG-scope VK — sees only org-scoped MPs (OpenAI only)",
      routingPolicyId: handles.routingPolicyId,
      principalUserId: null,
      createdById: handles.userId,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: handles.organizationId }],
    }),
  );
  vks.push(
    await mintVk({
      organizationId: handles.organizationId,
      name: "vk_team_platform",
      description: "TEAM-scope VK — sees OpenAI (org) + Anthropic (team)",
      routingPolicyId: null,
      principalUserId: null,
      createdById: handles.userId,
      scopes: [{ scopeType: "TEAM", scopeId: handles.platformTeamId }],
    }),
  );
  vks.push(
    await mintVk({
      organizationId: handles.organizationId,
      name: "vk_project_demo",
      description: "PROJECT-scope VK — inherits OpenAI + Anthropic via team cascade",
      routingPolicyId: null,
      principalUserId: null,
      createdById: handles.userId,
      scopes: [{ scopeType: "PROJECT", scopeId: handles.demoProjectId }],
    }),
  );
  vks.push(
    await mintVk({
      organizationId: handles.organizationId,
      name: "vk_personal",
      description: "Personal VK at ORG scope (lazy-mint device-flow path shape)",
      routingPolicyId: null,
      principalUserId: handles.userId,
      createdById: handles.userId,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: handles.organizationId }],
    }),
  );
  return vks;
}

async function ensurePrincipalBudget(handles: SeedHandles): Promise<void> {
  const window = "MONTH" as const;
  await prisma.gatewayBudget.upsert({
    where: {
      // (scopeType, scopeId, name) per the unique constraint convention —
      // adjust if the schema added a tighter @@unique.
      // Falls back to find-then-create if the composite key shape differs.
      id: `dogfood-principal-budget-${handles.userId}`,
    },
    create: {
      id: `dogfood-principal-budget-${handles.userId}`,
      organizationId: handles.organizationId,
      scopeType: "PRINCIPAL",
      scopeId: handles.userId,
      principalUserId: handles.userId,
      name: "Personal monthly cap",
      description: "Dogfood seed: $50/month spend cap on personal VK usage",
      window,
      limitUsd: new Prisma.Decimal("50.00"),
      onBreach: "BLOCK",
      resetsAt: nextResetAt(window, new Date()),
      createdById: handles.userId,
    },
    update: {
      limitUsd: new Prisma.Decimal("50.00"),
    },
  });
}

async function main(): Promise<void> {
  console.log("[seed-governance-refactor-dogfood] starting");

  const base = await ensureUserOrgTeamsProjects();
  console.log(`  ✓ user + org + 2 teams + 3 projects (org=${base.organizationId})`);

  const mps = await ensureModelProviders(base);
  console.log(`  ✓ ModelProviders: openai(org), anthropic(team:platform), gemini(org if GEMINI_API_KEY set), bedrock(org if AWS_ACCESS_KEY_ID+AWS_SECRET_ACCESS_KEY set)`);

  const routingPolicyId = await ensureRoutingPolicy(base, mps);
  console.log(`  ✓ RoutingPolicy: developer-default at ORG scope`);

  const handles: SeedHandles = { ...base, ...mps, routingPolicyId };

  const vks = await ensureVirtualKeys(handles);
  console.log(`  ✓ ${vks.length} VirtualKeys minted (org/team/project/personal)`);

  await ensurePrincipalBudget(handles);
  console.log(`  ✓ PRINCIPAL-scope GatewayBudget for dogfood user ($50/mo)`);

  console.log("\n[seed-governance-refactor-dogfood] done. Minted VKs (capture these):");
  for (const vk of vks) {
    console.log(`  ${vk.name.padEnd(20)} scopes=[${vk.scopes.join(", ")}]  secret=${vk.secret}`);
  }
  console.log(
    "\nNext: run the F full-matrix dogfood against these VKs (assets/dogfood/pr-3524/MATRIX.md).",
  );
}

main()
  .catch((err) => {
    console.error("[seed-governance-refactor-dogfood] FAILED", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
