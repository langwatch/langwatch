/**
 * Idempotent local-dev / CI seed: fixed, hardcoded ids (never random) for
 * Organization, Team, Project, admin User (upserted by ID, not email) and
 * API tokens — plaintext identical everywhere, only the bcrypt hash differs.
 */

import fs from "fs";
import { fileURLToPath } from "url";

import { API_KEY_PREFIX, INGEST_KEY_PREFIX } from "@langwatch/api-key-contract";
import { hashApiKeySecret } from "@langwatch/api-key-process";
import { DEFAULT_LICENSE_PUBLIC_KEY as PUBLIC_KEY } from "@langwatch/enterprise-licensing-contract";
import {
  LOCAL_DEV_ENTERPRISE_LICENSE_KEY,
  resolveSeedLicense,
} from "@langwatch/enterprise-licensing-process/seeding";
import { ENTERPRISE_LICENSE_KEY as TEST_SUITE_ENTERPRISE_LICENSE_KEY } from "@langwatch/enterprise-licensing-process/testing";
import { modelProviders } from "@langwatch/model-provider-contract";
import { runScript, writeScriptWarning } from "@langwatch/observability";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import {
  PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@langwatch/prisma-client/generated";
import { ROLE_KIND } from "@langwatch/role-contract";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-process";
import { hash as hashPassword } from "bcrypt";
import { parse as parseDotenv } from "dotenv";

import { resolveApiKeyPepper } from "./api-key-pepper.ts";
import { seedDemoPlatform } from "./seed-demo-platform.ts";
import {
  buildAdminUserUpsertArgs,
  resolveSeedEmailDomain,
  seedEmailAddress,
} from "./seed-identity.ts";

/** The lane name haven runs this under, and what its structured lines carry. */
const SEED_LANE = "seed";

const prisma = new PrismaClient({
  adapter: PrismaDriverAdapterService.create().createOwnedAdapter(process.env.DATABASE_URL ?? ""),
});

const ORG_ID = "local-dev-organization";
const ORG_SLUG = "local-dev-org";
const ORG_NAME = "Local Dev Organization";

const TEAM_ID = "local-dev-team";
const TEAM_SLUG = "local-dev-team";
const TEAM_NAME = "Local Dev Team";

const PROJECT_ID = "local-dev-project";
const PROJECT_SLUG = "local-dev-project";
const PROJECT_NAME = "Local Dev Project";

const ADMIN_USER_ID = "local-dev-admin-user";
const ADMIN_LOCAL_PART = "admin";
// SEED_EMAIL_DOMAIN is a purely opt-in per-stack override (see
// seed-identity.ts); unset, every seeded address stays on the one stable
// global domain.
const ADMIN_EMAIL = seedEmailAddress({
  localPart: ADMIN_LOCAL_PART,
  domainOverride: resolveSeedEmailDomain({ environment: process.env }),
});
const ADMIN_PASSWORD = "LocalHavenAdmin!2026";
const ADMIN_NAME = "Haven Local Admin";

// Must match domain.DefaultLocalAPIKey in tools/thuishaven/domain/overlay.go.
const DEFAULT_INGESTION_KEY = "sk-lw-local-development-key";

const PRIVATE_TOKEN_LOOKUP_ID = "LocalDevPrivate1";
const PRIVATE_TOKEN_SECRET = "LocalDevPrivateAccessTokenSecretFixedValue000000";
const PRIVATE_ACCESS_TOKEN = `${API_KEY_PREFIX}${PRIVATE_TOKEN_LOOKUP_ID}_${PRIVATE_TOKEN_SECRET}`;

const PUBLIC_TOKEN_LOOKUP_ID = "LocalDevPublicIk";
const PUBLIC_TOKEN_SECRET = "LocalDevPublicIngestionTokenSecretFixedValue0000";
const PUBLIC_ACCESS_TOKEN = `${INGEST_KEY_PREFIX}${PUBLIC_TOKEN_LOOKUP_ID}_${PUBLIC_TOKEN_SECRET}`;
const PUBLIC_TOKEN_ROLE_NAME = "local-dev-public-ingestion";

const MODEL_DEFAULT_CONFIG_ID = "local-dev-model-default-config";

/** The prompt tag `resolveLangyPrompt` reads by default. */
const DEFAULT_PROMPT_TAG = "production";
const DEFAULT_PROMPT_TAG_ID = "local-dev-prompt-tag-production";

async function main() {
  // Both pepper keys are optional in development. Absent, the seed says which
  // ones it looked for, once, and goes on to seed everything that does not
  // need one — never a stack trace, and never a failed `haven up`.
  const { pepper: apiKeyPepper, absent } = await resolveApiKeyPepper({ source: process.env });
  if (apiKeyPepper === undefined) {
    writeScriptWarning({
      name: SEED_LANE,
      msg: "no API-key pepper is configured — seeding the local identity without its access tokens",
      fields: { absent },
    });
  }
  // Prefer the haven-injected local credential (HAVEN_SEED_LANGWATCH_API_KEY); the
  // platform never carries LANGWATCH_API_KEY anymore, but keep it as a fallback for
  // non-haven flows that still pass one explicitly.
  const apiKey =
    process.env.HAVEN_SEED_LANGWATCH_API_KEY ??
    process.env.LANGWATCH_API_KEY ??
    DEFAULT_INGESTION_KEY;
  // Redact — in non-haven flows apiKey may be a real credential, and logs get shipped.
  console.log(`🌱 Seeding static local dev identity (ingestion key: ${apiKey.slice(0, 8)}…)`);

  // HAVEN_SEED_PRESET=demo seeds the project as already past onboarding, so
  // the UI opens on the real product instead of the "waiting for your first
  // message" journey (`haven seed --preset demo` sets this and ingests sample
  // traces). HAVEN_SEED_FIRST_MESSAGE=1|0 overrides the flag independently.
  const firstMessageOverride = process.env.HAVEN_SEED_FIRST_MESSAGE;
  const hasFirstMessageOverride = firstMessageOverride !== undefined;
  const isPastOnboarding = hasFirstMessageOverride
    ? firstMessageOverride === "1" || firstMessageOverride === "true"
    : process.env.HAVEN_SEED_PRESET === "demo";

  // The license must verify against the key this app boots with, otherwise
  // every settings page reports it as invalid. `resolveSeedLicense` keeps a
  // license that already verifies (someone activated a real one) and only
  // replaces what does not. The local-dev key verifies under the default key;
  // the test-suite fixture is there for CI, which seeds under the test key.
  const existingOrganization = await prisma.organization.findUnique({
    where: { id: ORG_ID },
    select: { license: true },
  });
  const license = resolveSeedLicense({
    stored: existingOrganization?.license ?? null,
    publicKey: PUBLIC_KEY,
    candidates: [LOCAL_DEV_ENTERPRISE_LICENSE_KEY, TEST_SUITE_ENTERPRISE_LICENSE_KEY],
  });
  const organization = await prisma.organization.upsert({
    where: { id: ORG_ID },
    create: {
      id: ORG_ID,
      name: ORG_NAME,
      slug: ORG_SLUG,
      license,
    },
    update: { license },
  });

  // Prompt tags are org-defined, and `production` is the one
  // `resolveLangyPrompt` reads by default — so without it every prompt seeded
  // into a new database needs the tag created by hand first, and anything that
  // resolves a prompt fails with "Invalid tag".
  await prisma.promptTag.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: DEFAULT_PROMPT_TAG,
      },
    },
    create: {
      id: DEFAULT_PROMPT_TAG_ID,
      organizationId: organization.id,
      name: DEFAULT_PROMPT_TAG,
    },
    update: {},
  });

  const team = await prisma.team.upsert({
    where: { id: TEAM_ID },
    create: {
      id: TEAM_ID,
      name: TEAM_NAME,
      slug: TEAM_SLUG,
      organizationId: organization.id,
    },
    update: {},
  });

  const project = await prisma.project.upsert({
    where: { id: PROJECT_ID },
    create: {
      id: PROJECT_ID,
      name: PROJECT_NAME,
      slug: PROJECT_SLUG,
      apiKey,
      teamId: team.id,
      language: "en",
      framework: "langchain",
      firstMessage: isPastOnboarding,
      integrated: isPastOnboarding,
    },
    // An explicit override must also be able to CLEAR the flags
    // (`haven seed --no-first-message`); without one, an existing true is kept.
    update:
      hasFirstMessageOverride || isPastOnboarding
        ? {
            apiKey,
            firstMessage: isPastOnboarding,
            integrated: isPastOnboarding,
          }
        : { apiKey },
  });

  // Admin user + BetterAuth credential (email/password) login. Upserted by
  // ADMIN_USER_ID, never by email, so this always finds the SAME account —
  // even one seeded under the retired admin@haven.localhost default — and
  // rewrites its email in place rather than ever creating a second admin.
  const user = await prisma.user.upsert(
    buildAdminUserUpsertArgs({
      adminUserId: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
    }),
  );

  const hashedPassword = await hashPassword(ADMIN_PASSWORD, 10);
  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: "credential",
        providerAccountId: user.id,
      },
    },
    create: {
      userId: user.id,
      provider: "credential",
      // better-auth 1.7 keys an account by `(issuer, accountId)`; the local
      // credential provider's issuer is `local:credential`, not
      // `local:oauth:credential`. Without it sign-in cannot find this row.
      issuer: "local:credential",
      providerAccountId: user.id,
      type: "credentials",
      password: hashedPassword,
    },
    // Repeated on the update leg so a re-run also repairs a row seeded before
    // the column existed.
    update: { issuer: "local:credential", password: hashedPassword },
  });

  await prisma.organizationUser.upsert({
    where: {
      userId_organizationId: {
        userId: user.id,
        organizationId: organization.id,
      },
    },
    create: { userId: user.id, organizationId: organization.id, role: "ADMIN" },
    update: { role: "ADMIN" },
  });
  await prisma.teamUser.upsert({
    where: { userId_teamId: { userId: user.id, teamId: team.id } },
    create: { userId: user.id, teamId: team.id, role: "ADMIN" },
    update: { role: "ADMIN" },
  });

  // RoleBinding has no single compound @@unique Prisma can upsert against
  // (see the model comment in schema.prisma), so dedupe by replace — the
  // same pattern scripts/seed-local-admin.ts already established.
  await prisma.roleBinding.deleteMany({
    where: { organizationId: organization.id, userId: user.id },
  });
  await prisma.roleBinding.createMany({
    data: [
      {
        organizationId: organization.id,
        userId: user.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organization.id,
      },
      {
        organizationId: organization.id,
        userId: user.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: team.id,
      },
    ],
  });

  // The two ApiKey rows are the only seeded state that needs the pepper, so a
  // checkout without one still gets its organization, team, project and admin
  // login — it just cannot write a hash the applications would verify.
  if (apiKeyPepper !== undefined) {
    await seedAccessTokens({
      apiKeyPepper,
      organizationId: organization.id,
      projectId: project.id,
      userId: user.id,
    });
  }

  // Default-model config at the organization scope so prompt-create +
  // workflow runs in e2e tests resolve a model without requiring CI to also
  // seed model-providers. Mirrors production first-provider onboarding: a
  // fresh org needs SOMETHING the cascade can hand back before any
  // prompt/eval can land.
  const defaultConfig = await prisma.modelDefaultConfig.upsert({
    where: { id: MODEL_DEFAULT_CONFIG_ID },
    create: {
      id: MODEL_DEFAULT_CONFIG_ID,
      organizationId: organization.id,
      config: {
        DEFAULT: "openai/gpt-5-mini",
        FAST: "openai/gpt-5-mini",
        EMBEDDINGS: "openai/text-embedding-3-small",
      },
    },
    update: {},
  });
  await prisma.modelDefaultConfigScope.upsert({
    where: {
      configId_scopeType_scopeId: {
        configId: defaultConfig.id,
        scopeType: "ORGANIZATION",
        scopeId: organization.id,
      },
    },
    create: {
      configId: defaultConfig.id,
      scopeType: "ORGANIZATION",
      scopeId: organization.id,
    },
    update: {},
  });

  // Provider credentials are stored AES-GCM-encrypted under the same pepper,
  // so they are skipped for the same reason the access tokens are.
  if (apiKeyPepper !== undefined) {
    await seedModelProvidersFromEnv(organization.id, apiKeyPepper);
  }

  if (process.env.HAVEN_SEED_PRESET === "demo") {
    await seedDemoPlatform({
      prisma,
      projectId: project.id,
      organizationId: organization.id,
      userId: user.id,
    });
  }

  console.log(`✅ Organization: ${organization.id} (${organization.slug})`);
  console.log(`✅ Team:         ${team.id} (${team.slug})`);
  console.log(`✅ Project:      ${project.id} (${project.slug})`);
  console.log(`✅ Admin login:  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  // Only echo the key in full when it's the non-secret default; otherwise redact
  // (same rationale as the seeding log above — real credentials must not hit shipped logs).
  const displayApiKey =
    project.apiKey === DEFAULT_INGESTION_KEY ? project.apiKey : `${project.apiKey.slice(0, 8)}…`;
  console.log(`✅ Ingestion key:        ${displayApiKey}`);
  if (apiKeyPepper !== undefined) {
    console.log(`✅ Private access token: ${PRIVATE_ACCESS_TOKEN}`);
    console.log(`✅ Public access token:  ${PUBLIC_ACCESS_TOKEN}`);
  }
}

/**
 * The two static access tokens, written under the resolved pepper. Split out
 * because they are the one part of the seed a checkout with no pepper skips.
 */
async function seedAccessTokens({
  apiKeyPepper,
  organizationId,
  projectId,
  userId,
}: {
  apiKeyPepper: string;
  organizationId: string;
  projectId: string;
  userId: string;
}) {
  // Private access token: sk-lw- full-access personal access token, owned by
  // the admin user, ORGANIZATION-scope ADMIN — the ApiKey-table equivalent of
  // a GitHub PAT.
  const privateApiKey = await prisma.apiKey.upsert({
    where: { lookupId: PRIVATE_TOKEN_LOOKUP_ID },
    create: {
      name: "Local Dev Private Access Token",
      description: "Static local-dev personal access token seeded by @langwatch/storage-seed",
      lookupId: PRIVATE_TOKEN_LOOKUP_ID,
      hashedSecret: hashApiKeySecret(PRIVATE_TOKEN_SECRET, apiKeyPepper),
      permissionMode: "all",
      userId: userId,
      createdByUserId: userId,
      organizationId: organizationId,
    },
    update: {
      hashedSecret: hashApiKeySecret(PRIVATE_TOKEN_SECRET, apiKeyPepper),
      userId: userId,
      organizationId: organizationId,
      revokedAt: null,
    },
  });
  await prisma.roleBinding.deleteMany({
    where: { apiKeyId: privateApiKey.id },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId: organizationId,
      apiKeyId: privateApiKey.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organizationId,
    },
  });

  // Public access token: ik-lw- ingestion-only token, PROJECT-scoped, CUSTOM
  // role restricted to traces:create — mirrors what ApiKeyService.create()
  // mints for a real ingestion key, just with a fixed token.
  const ingestionRole = await prisma.customRole.upsert({
    where: {
      organizationId_name: {
        organizationId: organizationId,
        name: PUBLIC_TOKEN_ROLE_NAME,
      },
    },
    create: {
      organizationId: organizationId,
      name: PUBLIC_TOKEN_ROLE_NAME,
      description:
        "Restricted role for the static local-dev public ingestion token (traces:create only)",
      permissions: ["traces:create"],
      kind: ROLE_KIND.SYSTEM_API_KEY,
    },
    update: { permissions: ["traces:create"] },
  });
  const publicApiKey = await prisma.apiKey.upsert({
    where: { lookupId: PUBLIC_TOKEN_LOOKUP_ID },
    create: {
      name: "Local Dev Public Ingestion Token",
      description:
        "Static local-dev ingestion-only token (traces:create) seeded by @langwatch/storage-seed",
      lookupId: PUBLIC_TOKEN_LOOKUP_ID,
      hashedSecret: hashApiKeySecret(PUBLIC_TOKEN_SECRET, apiKeyPepper),
      permissionMode: "restricted",
      organizationId: organizationId,
    },
    update: {
      hashedSecret: hashApiKeySecret(PUBLIC_TOKEN_SECRET, apiKeyPepper),
      organizationId: organizationId,
      revokedAt: null,
    },
  });
  await prisma.roleBinding.deleteMany({ where: { apiKeyId: publicApiKey.id } });
  await prisma.roleBinding.create({
    data: {
      organizationId: organizationId,
      apiKeyId: publicApiKey.id,
      role: TeamUserRole.CUSTOM,
      customRoleId: ingestionRole.id,
      scopeType: RoleBindingScopeType.PROJECT,
      scopeId: projectId,
    },
  });
}

// Model providers from the environment: for every registry provider whose
// API-key variable is set (process env / .env / repo-root .env), upsert an
// enabled, ORGANIZATION-scoped ModelProvider row under a fixed per-provider
// ID (idempotent). HAVEN_SEED_MODEL_PROVIDERS=0 disables the whole block.

const MODEL_PROVIDER_ID_PREFIX = "local-dev-model-provider-";

/**
 * The at-rest format for ModelProvider.customKeys: AES-256-GCM under the
 * deployment's own 32-byte hex pepper, written `iv:ciphertext:authTag` —
 * `@langwatch/secret-process` owns the format; the key comes from the boot seam.
 */
function encryptCredentials(value: string, key: string): string {
  return AesGcmSecretEncryptionAdapter.create({ key }).encrypt(value);
}

// loadSeedEnv merges dotenv layers with process env winning over the
// repository-root .env, resolving the path from this file rather than
// process.cwd(): the seed runs as a prisma `migrations.seed` command, a
// package script, and via haven from the repo root — all three read the same file.
function loadSeedEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
  // An absent file is fine: the process environment may already carry
  // everything. A file that is present and unreadable is not, and throws.
  if (fs.existsSync(rootEnv)) {
    Object.assign(merged, parseDotenv(fs.readFileSync(rootEnv)));
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}

// schemaKeyNames lists a provider's credential variable names from its zod
// keysSchema, unwrapping ZodEffects (superRefine) to reach the object shape.
function schemaKeyNames(schema: unknown): string[] {
  let inner = schema as { _def?: { schema?: unknown }; shape?: object };
  while (inner?._def?.schema) {
    inner = inner._def.schema as typeof inner;
  }
  return inner?.shape ? Object.keys(inner.shape) : [];
}

async function seedModelProvidersFromEnv(organizationId: string, pepper: string) {
  const flag = process.env.HAVEN_SEED_MODEL_PROVIDERS;
  if (flag === "0" || flag === "false") {
    console.log("⏭️  Model providers: seeding disabled (HAVEN_SEED_MODEL_PROVIDERS=0)");
    return;
  }
  const envMap = loadSeedEnv();
  for (const [provider, def] of Object.entries(modelProviders)) {
    // "custom" has no inferable identity from the environment; skip it.
    if (provider === "custom") continue;
    if (!envMap[def.apiKey]) continue;

    const keyNames = schemaKeyNames(def.keysSchema);
    const endpointKey = "endpointKey" in def ? def.endpointKey : void 0;
    const names = keyNames.length > 0 ? keyNames : [def.apiKey, endpointKey];
    const keys: Record<string, string> = {};
    for (const name of names) {
      if (name && envMap[name]) keys[name] = envMap[name];
    }
    // The registry schemas mark every key `.nullable().optional()` (to allow
    // env-var fallback in inbound payloads), so safeParse alone would happily
    // seed an enabled-but-unusable provider (e.g. Bedrock with only the access
    // key). Require every non-optional key; Azure needs its API key plus
    // either mode's endpoint, not both.
    const optionalKeys = new Set("optionalKeys" in def ? (def.optionalKeys ?? []) : []);
    let missing = names.filter(
      (name): name is string => Boolean(name) && !optionalKeys.has(name!) && !keys[name!],
    );
    if (provider === "azure") {
      const endpointNames = ["AZURE_OPENAI_ENDPOINT", "AZURE_API_GATEWAY_BASE_URL"];
      missing = missing.filter((name) => !endpointNames.includes(name));
      if (!endpointNames.some((name) => keys[name])) {
        missing.push(endpointNames.join(" or "));
      }
    }
    const parsed = def.keysSchema.safeParse(keys);
    if (!parsed.success || missing.length > 0) {
      console.log(
        `⏭️  Model provider ${provider}: ${def.apiKey} is set but the key set is incomplete${
          missing.length > 0 ? ` (missing ${missing.join(", ")})` : ""
        } — skipped`,
      );
      continue;
    }

    const id = MODEL_PROVIDER_ID_PREFIX + provider;
    const customKeys = encryptCredentials(JSON.stringify(keys), pepper);
    const row = await prisma.modelProvider.upsert({
      where: { id },
      create: {
        id,
        name: def.name,
        provider,
        enabled: true,
        customKeys,
        organizationId,
      },
      update: { customKeys, enabled: true, disabledAt: null },
    });
    await prisma.modelProviderScope.upsert({
      where: {
        modelProviderId_scopeType_scopeId: {
          modelProviderId: row.id,
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        },
      },
      create: {
        modelProviderId: row.id,
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
      },
      update: {},
    });
    console.log(`✅ Model provider: ${provider} (keys from environment)`);
  }
}

await runScript({
  name: SEED_LANE,
  main: async () => {
    try {
      await main();
    } finally {
      await prisma.$disconnect();
    }
  },
});
