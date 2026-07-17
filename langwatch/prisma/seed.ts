/**
 * Idempotent local-dev / CI seed. Creates (or upserts, on re-run) one
 * Organization, Team, Project, and a BetterAuth-credential admin User, plus a
 * private (full-access) and a public (ingestion-only) API token. haven
 * (tools/thuishaven) runs this on every `haven up`; sdk-javascript-ci.yml's
 * e2e job and charts/langwatch/tests/e2e-full-stack.sh run it against a fresh
 * database per CI run.
 *
 * Optional extras (all env-gated, all idempotent):
 *   - Model providers from the environment (HAVEN_SEED_MODEL_PROVIDERS=0
 *     disables): every registry provider whose API-key variable is set in the
 *     process env / langwatch/.env / repo-root .env gets an enabled,
 *     org-scoped ModelProvider row with those keys.
 *   - HAVEN_SEED_FIRST_MESSAGE=1|0 forces the project's firstMessage/
 *     integrated flags on or off, independent of HAVEN_SEED_PRESET=demo.
 *
 * Every identity value below is a fixed, hardcoded constant — nothing here is
 * randomly generated. The same admin login and the same organization/team/
 * project/user IDs and keys/tokens exist on every worktree and every
 * machine. Re-running upserts by these fixed IDs, so nothing is ever
 * duplicated — `haven up` can call this on every up.
 *
 * Admin login (BetterAuth email + password, bcrypt-hashed — the same
 * mechanism as scripts/seed-local-admin.ts, but a distinct identity so the
 * two seeders never collide on email):
 *   Email:    admin@haven.localhost
 *   Password: LocalHavenAdmin!2026
 *
 * IDs:
 *   Organization: local-dev-organization
 *   Team:         local-dev-team
 *   Project:      local-dev-project
 *   User:         local-dev-admin-user
 *
 * Ingestion key — Project.apiKey, the legacy project key SDKs paste into
 * LANGWATCH_API_KEY (exact-string-match lookup; see token-resolver.ts's
 * "legacyProjectKey" path — this predates and is independent of the ApiKey
 * table below). Overridable via the LANGWATCH_API_KEY env var: haven injects
 * this same default automatically (domain.DefaultLocalAPIKey in
 * tools/thuishaven/domain/overlay.go — keep the two in sync by hand, they
 * intentionally can't share a constant across the Go/TS boundary), and CI
 * sets its own per-workflow value:
 *   sk-lw-local-development-key
 *
 * Private access token — an ApiKey-table row (sk-lw- prefix), owned by the
 * admin user with an ORGANIZATION-scope ADMIN binding: a full-access personal
 * access token, the same shape api-key.service.ts mints for a real PAT, just
 * with a fixed token instead of a randomly generated one:
 *   sk-lw-LocalDevPrivate1_LocalDevPrivateAccessTokenSecretFixedValue000000
 *
 * Public access token — an ApiKey-table row using ik-lw-, this codebase's
 * actual "ingestion-only" key prefix, PROJECT-scoped and restricted by a
 * CUSTOM role to traces:create only. This is the closest real equivalent to
 * a "safe to embed more broadly" public token that exists here — there is no
 * client-side-safe/publishable-key concept in this codebase, so it is still
 * a bearer secret, just the least-privileged key type available:
 *   ik-lw-LocalDevPublicIk_LocalDevPublicIngestionTokenSecretFixedValue0000
 *
 * The plaintext tokens above are identical on every machine; only their
 * stored hash differs, because hashSecret() keys on each machine's own
 * CREDENTIALS_SECRET/NEXTAUTH_SECRET pepper (by design — a database-only leak
 * must stay useless without it). Verification always succeeds locally
 * because hashing and verifying both read that same local pepper.
 */
import fs from "fs";
import path from "path";

import { PrismaClient, RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { hash as hashPassword } from "bcrypt";
import { parse as parseDotenv } from "dotenv";
import { ENTERPRISE_LICENSE_KEY } from "../ee/licensing/__tests__/fixtures/testLicenses";
import { modelProviders } from "../src/server/modelProviders/registry";
import { encrypt } from "../src/utils/encryption";
import {
  API_KEY_PREFIX,
  INGEST_KEY_PREFIX,
  hashSecret,
} from "../src/server/api-key/api-key-token.utils";
import { CUSTOM_ROLE_KIND } from "../src/server/role/repositories/role.repository";

const prisma = new PrismaClient();

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
const ADMIN_EMAIL = "admin@haven.localhost";
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

async function main() {
  // Prefer the haven-injected local credential (HAVEN_SEED_LANGWATCH_API_KEY); the
  // platform never carries LANGWATCH_API_KEY anymore, but keep it as a fallback for
  // non-haven flows that still pass one explicitly.
  const apiKey =
    process.env.HAVEN_SEED_LANGWATCH_API_KEY ??
    process.env.LANGWATCH_API_KEY ??
    DEFAULT_INGESTION_KEY;
  // Redact — in non-haven flows apiKey may be a real credential, and logs get shipped.
  console.log(
    `🌱 Seeding static local dev identity (ingestion key: ${apiKey.slice(0, 8)}…)`,
  );

  // HAVEN_SEED_PRESET=demo seeds the project as already past onboarding
  // (firstMessage/integrated set), so the UI opens on the real product instead
  // of the "waiting for your first message" journey. `haven seed --preset demo`
  // sets this and then ingests sample traces through the collector.
  // HAVEN_SEED_FIRST_MESSAGE=1|0 overrides that flag independently of the
  // preset (`haven seed --first-message` sets it).
  const firstMessageOverride = process.env.HAVEN_SEED_FIRST_MESSAGE;
  const hasFirstMessageOverride = firstMessageOverride !== undefined;
  const isPastOnboarding = hasFirstMessageOverride
    ? firstMessageOverride === "1" || firstMessageOverride === "true"
    : process.env.HAVEN_SEED_PRESET === "demo";

  const organization = await prisma.organization.upsert({
    where: { id: ORG_ID },
    create: {
      id: ORG_ID,
      name: ORG_NAME,
      slug: ORG_SLUG,
      license: ENTERPRISE_LICENSE_KEY,
    },
    update: { license: ENTERPRISE_LICENSE_KEY },
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
        ? { apiKey, firstMessage: isPastOnboarding, integrated: isPastOnboarding }
        : { apiKey },
  });

  // Admin user + BetterAuth credential (email/password) login.
  const user = await prisma.user.upsert({
    where: { id: ADMIN_USER_ID },
    create: {
      id: ADMIN_USER_ID,
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      emailVerified: true,
    },
    update: {},
  });

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
      providerAccountId: user.id,
      type: "credentials",
      password: hashedPassword,
    },
    update: { password: hashedPassword },
  });

  await prisma.organizationUser.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
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

  // Private access token: sk-lw- full-access personal access token, owned by
  // the admin user, ORGANIZATION-scope ADMIN — the ApiKey-table equivalent of
  // a GitHub PAT.
  const privateApiKey = await prisma.apiKey.upsert({
    where: { lookupId: PRIVATE_TOKEN_LOOKUP_ID },
    create: {
      name: "Local Dev Private Access Token",
      description: "Static local-dev personal access token seeded by prisma/seed.ts",
      lookupId: PRIVATE_TOKEN_LOOKUP_ID,
      hashedSecret: hashSecret(PRIVATE_TOKEN_SECRET),
      permissionMode: "all",
      userId: user.id,
      createdByUserId: user.id,
      organizationId: organization.id,
    },
    update: {
      hashedSecret: hashSecret(PRIVATE_TOKEN_SECRET),
      userId: user.id,
      organizationId: organization.id,
      revokedAt: null,
    },
  });
  await prisma.roleBinding.deleteMany({ where: { apiKeyId: privateApiKey.id } });
  await prisma.roleBinding.create({
    data: {
      organizationId: organization.id,
      apiKeyId: privateApiKey.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organization.id,
    },
  });

  // Public access token: ik-lw- ingestion-only token, PROJECT-scoped, CUSTOM
  // role restricted to traces:create — mirrors what ApiKeyService.create()
  // mints for a real ingestion key, just with a fixed token.
  const ingestionRole = await prisma.customRole.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: PUBLIC_TOKEN_ROLE_NAME } },
    create: {
      organizationId: organization.id,
      name: PUBLIC_TOKEN_ROLE_NAME,
      description: "Restricted role for the static local-dev public ingestion token (traces:create only)",
      permissions: ["traces:create"],
      kind: CUSTOM_ROLE_KIND.SYSTEM_API_KEY,
    },
    update: { permissions: ["traces:create"] },
  });
  const publicApiKey = await prisma.apiKey.upsert({
    where: { lookupId: PUBLIC_TOKEN_LOOKUP_ID },
    create: {
      name: "Local Dev Public Ingestion Token",
      description: "Static local-dev ingestion-only token (traces:create) seeded by prisma/seed.ts",
      lookupId: PUBLIC_TOKEN_LOOKUP_ID,
      hashedSecret: hashSecret(PUBLIC_TOKEN_SECRET),
      permissionMode: "restricted",
      organizationId: organization.id,
    },
    update: {
      hashedSecret: hashSecret(PUBLIC_TOKEN_SECRET),
      organizationId: organization.id,
      revokedAt: null,
    },
  });
  await prisma.roleBinding.deleteMany({ where: { apiKeyId: publicApiKey.id } });
  await prisma.roleBinding.create({
    data: {
      organizationId: organization.id,
      apiKeyId: publicApiKey.id,
      role: TeamUserRole.CUSTOM,
      customRoleId: ingestionRole.id,
      scopeType: RoleBindingScopeType.PROJECT,
      scopeId: project.id,
    },
  });

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

  await seedModelProvidersFromEnv(organization.id);

  console.log(`✅ Organization: ${organization.id} (${organization.slug})`);
  console.log(`✅ Team:         ${team.id} (${team.slug})`);
  console.log(`✅ Project:      ${project.id} (${project.slug})`);
  console.log(`✅ Admin login:  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  // Only echo the key in full when it's the non-secret default; otherwise redact
  // (same rationale as the seeding log above — real credentials must not hit shipped logs).
  const displayApiKey =
    project.apiKey === DEFAULT_INGESTION_KEY
      ? project.apiKey
      : `${project.apiKey.slice(0, 8)}…`;
  console.log(`✅ Ingestion key:        ${displayApiKey}`);
  console.log(`✅ Private access token: ${PRIVATE_ACCESS_TOKEN}`);
  console.log(`✅ Public access token:  ${PUBLIC_ACCESS_TOKEN}`);
}

// ---------------------------------------------------------------------------
// Model providers from the environment.
//
// For every provider in the registry whose primary API-key variable is set —
// in the process env, langwatch/.env, or the repo-root .env — upsert an
// enabled, ORGANIZATION-scoped ModelProvider carrying those keys (encrypted
// exactly as modelProvider.repository does), so a fresh local stack can talk
// to the providers the developer already has credentials for without pasting
// them into the settings UI. Fixed per-provider row IDs keep re-runs
// idempotent. HAVEN_SEED_MODEL_PROVIDERS=0 disables the whole block
// (`haven seed --skip-model-providers`).
// ---------------------------------------------------------------------------

const MODEL_PROVIDER_ID_PREFIX = "local-dev-model-provider-";

// loadSeedEnv merges the dotenv layers under the child's real precedence:
// process env wins over langwatch/.env, which wins over the repo-root .env.
// The seed always runs with cwd=langwatch/ (haven, CI, and the pnpm script
// all invoke it there).
function loadSeedEnv(): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const file of [path.join("..", ".env"), ".env"]) {
    try {
      Object.assign(merged, parseDotenv(fs.readFileSync(file)));
    } catch {
      // missing file — fine, the layer just doesn't exist
    }
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

async function seedModelProvidersFromEnv(organizationId: string) {
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
    const names = keyNames.length > 0 ? keyNames : [def.apiKey, def.endpointKey];
    const keys: Record<string, string> = {};
    for (const name of names) {
      if (name && envMap[name]) keys[name] = envMap[name];
    }
    // The registry schemas mark every key `.nullable().optional()` (to allow
    // env-var fallback in inbound payloads), so safeParse alone would happily
    // seed an enabled-but-unusable provider (e.g. Bedrock with only the access
    // key). Require every non-optional key; Azure needs its API key plus
    // either mode's endpoint, not both.
    const optionalKeys = new Set(
      "optionalKeys" in def ? (def.optionalKeys ?? []) : [],
    );
    let missing = names.filter(
      (name): name is string =>
        Boolean(name) && !optionalKeys.has(name!) && !keys[name!],
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
    const customKeys = encrypt(JSON.stringify(keys));
    const row = await prisma.modelProvider.upsert({
      where: { id },
      create: { id, name: def.name, provider, enabled: true, customKeys, organizationId },
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

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
