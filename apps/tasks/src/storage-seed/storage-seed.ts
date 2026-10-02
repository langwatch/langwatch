/**
 * Idempotent local-dev / CI seed: fixed, hardcoded ids (never random) for
 * Organization, Team, Project, admin User (upserted by ID, not email) and
 * API tokens — plaintext identical everywhere, only the bcrypt hash differs.
 */

import { createHash, createHmac } from "node:crypto";

import { API_KEY_PREFIX, INGEST_KEY_PREFIX } from "@langwatch/api-key-contract";
import { allowLoopbackVoiceProviders, Config, parseProcessConfig } from "@langwatch/config";
import {
  DEFAULT_LICENSE_PUBLIC_KEY,
  licensingConfig,
  licensingSecrets,
} from "@langwatch/enterprise-licensing-contract";
import {
  elevenLabsLoopbackKeysSchema,
  getSchemaShape,
  modelProviders,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { aesEncryption, type Encryption } from "@langwatch/process-stores";
import { ROLE_KIND } from "@langwatch/role-contract";
import { SecretsResolver } from "@langwatch/secrets";
import { hash as hashPassword } from "bcrypt";

import type { TaskInput } from "../config.ts";
import { resolveApiKeyPepper } from "./api-key-pepper.ts";
import {
  adminGrantBindings,
  privateTokenGrantBinding,
  publicTokenGrantBinding,
  seedGrantBinding,
  seedRoleProjection,
} from "./seed-authz.ts";
import { seedDemoPlatform } from "./seed-demo-platform.ts";
import {
  buildAdminUserUpsertArgs,
  resolveSeedEmailDomain,
  seedEmailAddress,
} from "./seed-identity.ts";
import { chooseSeedLicense, type SeedLicenseChoice } from "./seed-license.ts";

const logger = createLogger("langwatch:tasks:storage-seed");

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
const ADMIN_PASSWORD = "LocalHavenAdmin!2026";
const ADMIN_NAME = "Haven Local Admin";

/** The tools' own accounts, so no tool answers the admin's passkey offer or sessions. */
const TOOL_USERS = [
  { id: "local-dev-fuzz-ui-user", localPart: "fuzz-ui", name: "Fuzz UI" },
  { id: "local-dev-passkey-probe-user", localPart: "passkey-probe", name: "Passkey Probe" },
] as const;

// Must match domain.DefaultLocalAPIKey in tools/thuishaven/domain/overlay.go.
const DEFAULT_INGESTION_KEY = "sk-lw-local-development-key";

const PRIVATE_TOKEN_LOOKUP_ID = "LocalDevPrivate1";
const PRIVATE_TOKEN_SECRET = "LocalDevPrivateAccessTokenSecretFixedValue000000";
const PRIVATE_ACCESS_TOKEN = `${API_KEY_PREFIX}${PRIVATE_TOKEN_LOOKUP_ID}_${PRIVATE_TOKEN_SECRET}`;

const PUBLIC_TOKEN_LOOKUP_ID = "LocalDevPublicIk";
const PUBLIC_TOKEN_SECRET = "LocalDevPublicIngestionTokenSecretFixedValue0000";
const PUBLIC_ACCESS_TOKEN = `${INGEST_KEY_PREFIX}${PUBLIC_TOKEN_LOOKUP_ID}_${PUBLIC_TOKEN_SECRET}`;
const PUBLIC_TOKEN_ROLE_NAME = "local-dev-public-ingestion";
const PUBLIC_TOKEN_ROLE_ID = "local-dev-public-ingestion-role";
const PUBLIC_TOKEN_ROLE_DESCRIPTION =
  "Restricted role for the static local-dev public ingestion token (traces:create only)";

const MODEL_DEFAULT_CONFIG_ID = "local-dev-model-default-config";

const SCIM_TOKEN_ID = "local-dev-scim-token";

/** The prompt tag `resolveLangyPrompt` reads by default. */
const DEFAULT_PROMPT_TAG = "production";
const DEFAULT_PROMPT_TAG_ID = "local-dev-prompt-tag-production";

/** The idempotent local-dev / CI seed: fixed ids and tokens, written straight to the database. */
export async function storageSeed({ connections, chain, environment }: TaskInput): Promise<void> {
  const database = connections.database;
  if (!database) throw new Error("This task needs DATABASE_URL");
  const prisma = database.client;

  // SEED_EMAIL_DOMAIN is a purely opt-in per-stack override (see seed-identity.ts); unset,
  // every seeded address stays on the one stable global domain.
  const adminEmail = seedEmailAddress({
    localPart: ADMIN_LOCAL_PART,
    domainOverride: resolveSeedEmailDomain({ environment }),
  });

  // Absent, the seed names the pepper it looked for, once, and seeds everything that does not
  // need one — never a stack trace, and never a failed `haven up`.
  const { pepper: apiKeyPepper, absent } = await resolveApiKeyPepper({ chain });
  if (apiKeyPepper === undefined) {
    logger.warn(
      { absent },
      "no API-key pepper is configured — seeding the local identity without its access tokens",
    );
  }
  // Prefer the haven-injected local credential (HAVEN_SEED_LANGWATCH_API_KEY); the
  // platform never carries LANGWATCH_API_KEY anymore, but keep it as a fallback for
  // non-haven flows that still pass one explicitly.
  const apiKey =
    environment.HAVEN_SEED_LANGWATCH_API_KEY ??
    environment.LANGWATCH_API_KEY ??
    DEFAULT_INGESTION_KEY;
  // Redact — in non-haven flows apiKey may be a real credential, and logs get shipped.
  logger.info({ ingestionKey: `${apiKey.slice(0, 8)}…` }, "seeding the static local dev identity");

  // HAVEN_SEED_PRESET=demo seeds the project as already past onboarding, so
  // the UI opens on the real product instead of the "waiting for your first
  // message" journey (`haven seed --preset demo` sets this and ingests sample
  // traces). HAVEN_SEED_FIRST_MESSAGE=1|0 overrides the flag independently.
  const firstMessageOverride = environment.HAVEN_SEED_FIRST_MESSAGE;
  const hasFirstMessageOverride = firstMessageOverride !== undefined;
  const isPastOnboarding = hasFirstMessageOverride
    ? firstMessageOverride === "1" || firstMessageOverride === "true"
    : environment.HAVEN_SEED_PRESET === "demo";

  // The licence must be valid under the key this stack boots with. No licence is committed:
  // the seed signs one with the private key from secrets (seed-license.ts has the order).
  const existingOrganization = await prisma.organization.findUnique({
    where: { id: ORG_ID },
    select: { license: true },
  });
  const { licensing } = parseProcessConfig({
    owners: [{ name: "licensing", config: licensingConfig }],
    environment,
  });
  const secrets = SecretsResolver.over(chain).scopeTo("storage-seed", [
    licensingSecrets.licensePrivateKey,
  ]);
  const licenseChoice = await secrets.into(licensingSecrets.licensePrivateKey, (privateKey) =>
    chooseSeedLicense({
      stored: existingOrganization?.license ?? null,
      publicKey: licensing.publicKey ?? DEFAULT_LICENSE_PUBLIC_KEY,
      privateKey,
      organization: { id: ORG_ID, name: ORG_NAME, email: adminEmail },
    }),
  );
  logSeedLicenseChoice(licenseChoice);
  const license = licenseChoice.licenseKey;
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
      email: adminEmail,
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

  await prisma.roleBinding.deleteMany({
    where: { organizationId: organization.id, userId: user.id },
  });
  for (const binding of adminGrantBindings({
    organizationId: organization.id,
    teamId: team.id,
    userId: user.id,
  })) {
    await seedGrantBinding({ prisma, binding });
  }

  await seedToolUsers({
    prisma,
    environment,
    hashedPassword,
    organizationId: organization.id,
    teamId: team.id,
  });

  // The two ApiKey rows are the only seeded state that needs the pepper, so a
  // checkout without one still gets its organization, team, project and admin
  // login — it just cannot write a hash the applications would verify.
  if (apiKeyPepper !== undefined) {
    await seedAccessTokens({
      prisma,
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
      configId: defaultConfig.id,
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
    await seedModelProvidersFromEnv({
      prisma,
      environment,
      organizationId: organization.id,
      encryption: aesEncryption(new Uint8Array(Buffer.from(apiKeyPepper, "hex"))),
    });
  }

  // haven mints this per stack (HAVEN_SEED_SCIM_TOKEN) so the diff tools can call SCIM.
  if (environment.HAVEN_SEED_SCIM_TOKEN) {
    await seedScimToken({
      prisma,
      organizationId: organization.id,
      token: environment.HAVEN_SEED_SCIM_TOKEN,
    });
  }

  if (environment.HAVEN_SEED_PRESET === "demo") {
    await seedDemoPlatform({
      prisma,
      projectId: project.id,
      organizationId: organization.id,
      userId: user.id,
    });
  }

  // Only the non-secret default ingestion key is shown in full; anything else is redacted.
  const displayApiKey =
    project.apiKey === DEFAULT_INGESTION_KEY ? project.apiKey : `${project.apiKey.slice(0, 8)}…`;
  logger.info(
    {
      organization: `${organization.id} (${organization.slug})`,
      team: `${team.id} (${team.slug})`,
      project: `${project.id} (${project.slug})`,
      adminLogin: `${adminEmail} / ${ADMIN_PASSWORD}`,
      ingestionKey: displayApiKey,
      ...(apiKeyPepper !== undefined
        ? { privateAccessToken: PRIVATE_ACCESS_TOKEN, publicAccessToken: PUBLIC_ACCESS_TOKEN }
        : {}),
    },
    "seeded the static local dev identity",
  );
}

/**
 * An organization-wide SCIM token under the pepper-free sha256 digest main's
 * older rows use, so it verifies whichever pepper the stack resolves.
 */
/** Seeds each tool's own login, membership and admin grants beside the admin's. */
async function seedToolUsers({
  prisma,
  environment,
  hashedPassword,
  organizationId,
  teamId,
}: {
  prisma: PrismaClient;
  environment: TaskInput["environment"];
  hashedPassword: string;
  organizationId: string;
  teamId: string;
}): Promise<void> {
  for (const toolUser of TOOL_USERS) {
    const seeded = await prisma.user.upsert(
      buildAdminUserUpsertArgs({
        adminUserId: toolUser.id,
        email: seedEmailAddress({
          localPart: toolUser.localPart,
          domainOverride: resolveSeedEmailDomain({ environment }),
        }),
        name: toolUser.name,
      }),
    );
    await prisma.account.upsert({
      where: {
        provider_providerAccountId: { provider: "credential", providerAccountId: seeded.id },
      },
      create: {
        userId: seeded.id,
        provider: "credential",
        issuer: "local:credential",
        providerAccountId: seeded.id,
        type: "credentials",
        password: hashedPassword,
      },
      update: { issuer: "local:credential", password: hashedPassword },
    });
    await prisma.organizationUser.upsert({
      where: { userId_organizationId: { userId: seeded.id, organizationId } },
      create: { userId: seeded.id, organizationId, role: "ADMIN" },
      update: { role: "ADMIN" },
    });
    await prisma.teamUser.upsert({
      where: { userId_teamId: { userId: seeded.id, teamId } },
      create: { userId: seeded.id, teamId, role: "ADMIN" },
      update: { role: "ADMIN" },
    });
    await prisma.roleBinding.deleteMany({
      where: { organizationId, userId: seeded.id },
    });
    for (const binding of adminGrantBindings({
      organizationId,
      teamId,
      userId: seeded.id,
      ids: {
        organization: `${toolUser.id}-organization-binding`,
        team: `${toolUser.id}-team-binding`,
      },
    })) {
      await seedGrantBinding({ prisma, binding });
    }
  }
}

async function seedScimToken({
  prisma,
  organizationId,
  token,
}: {
  prisma: PrismaClient;
  organizationId: string;
  token: string;
}): Promise<void> {
  const hashedToken = createHash("sha256").update(token).digest("hex");
  await prisma.scimToken.upsert({
    where: { id: SCIM_TOKEN_ID },
    create: {
      id: SCIM_TOKEN_ID,
      organizationId,
      hashedToken,
      hashScheme: "sha256",
      description: "haven local SCIM token",
    },
    update: { hashedToken, hashScheme: "sha256" },
  });
}

/**
 * The two static access tokens, written under the resolved pepper. Split out
 * because they are the one part of the seed a checkout with no pepper skips.
 */
async function seedAccessTokens({
  prisma,
  apiKeyPepper,
  organizationId,
  projectId,
  userId,
}: {
  prisma: PrismaClient;
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
      description: "Static local-dev personal access token seeded by the storage-seed task",
      lookupId: PRIVATE_TOKEN_LOOKUP_ID,
      hashedSecret: hashApiKeySecret({ secret: PRIVATE_TOKEN_SECRET, pepper: apiKeyPepper }),
      permissionMode: "all",
      userId: userId,
      createdByUserId: userId,
      organizationId: organizationId,
    },
    update: {
      hashedSecret: hashApiKeySecret({ secret: PRIVATE_TOKEN_SECRET, pepper: apiKeyPepper }),
      userId: userId,
      organizationId: organizationId,
      revokedAt: null,
    },
  });
  await prisma.roleBinding.deleteMany({
    where: { apiKeyId: privateApiKey.id },
  });
  await seedGrantBinding({
    prisma,
    binding: privateTokenGrantBinding({ organizationId, apiKeyId: privateApiKey.id }),
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
      id: PUBLIC_TOKEN_ROLE_ID,
      organizationId: organizationId,
      name: PUBLIC_TOKEN_ROLE_NAME,
      description: PUBLIC_TOKEN_ROLE_DESCRIPTION,
      permissions: ["traces:create"],
      kind: ROLE_KIND.SYSTEM_API_KEY,
    },
    update: { permissions: ["traces:create"] },
  });
  const roleProjected = await seedRoleProjection({
    prisma,
    role: {
      id: ingestionRole.id,
      organizationId,
      name: PUBLIC_TOKEN_ROLE_NAME,
      description: PUBLIC_TOKEN_ROLE_DESCRIPTION,
      permissions: ["traces:create"],
      kind: ROLE_KIND.SYSTEM_API_KEY,
    },
  });
  const publicApiKey = await prisma.apiKey.upsert({
    where: { lookupId: PUBLIC_TOKEN_LOOKUP_ID },
    create: {
      name: "Local Dev Public Ingestion Token",
      description:
        "Static local-dev ingestion-only token (traces:create) seeded by the storage-seed task",
      lookupId: PUBLIC_TOKEN_LOOKUP_ID,
      hashedSecret: hashApiKeySecret({ secret: PUBLIC_TOKEN_SECRET, pepper: apiKeyPepper }),
      permissionMode: "restricted",
      organizationId: organizationId,
    },
    update: {
      hashedSecret: hashApiKeySecret({ secret: PUBLIC_TOKEN_SECRET, pepper: apiKeyPepper }),
      organizationId: organizationId,
      revokedAt: null,
    },
  });
  await prisma.roleBinding.deleteMany({ where: { apiKeyId: publicApiKey.id } });
  if (roleProjected) {
    await seedGrantBinding({
      prisma,
      binding: publicTokenGrantBinding({
        organizationId,
        projectId,
        apiKeyId: publicApiKey.id,
        roleId: ingestionRole.id,
      }),
    });
  }
}

// Model providers from the environment: for every registry provider whose
// API-key variable is set (process env / .env / repo-root .env), upsert an
// enabled, ORGANIZATION-scoped ModelProvider row under a fixed per-provider
// ID (idempotent). HAVEN_SEED_MODEL_PROVIDERS=0 disables the whole block.

const MODEL_PROVIDER_ID_PREFIX = "local-dev-model-provider-";

/** One line per outcome; the two that store nothing name the secret that fixes them. */
function logSeedLicenseChoice(choice: SeedLicenseChoice): void {
  if ("source" in choice) {
    logger.info({ source: choice.source }, "seeding the local organization's licence");
    return;
  }
  if (choice.reason === "unpaired-private-key") {
    logger.warn(
      "LANGWATCH_LICENSE_PRIVATE_KEY does not pair with this stack's licence public key (LANGWATCH_LICENSE_PUBLIC_KEY), so no licence is seeded",
    );
    return;
  }
  logger.warn(
    "no licence seeded: set LANGWATCH_LICENSE_PRIVATE_KEY (root .env or 1Password) to sign an enterprise licence for the local organization",
  );
}

/** The api-key module's at-rest hash: HMAC-SHA256 of the secret under the pepper, in hex. */
function hashApiKeySecret({ secret, pepper }: { secret: string; pepper: string }): string {
  return createHmac("sha256", pepper).update(secret).digest("hex");
}

type ModelProviderDefinition = (typeof modelProviders)[keyof typeof modelProviders];

/** A provider's credential variables, falling back to its API-key and endpoint names. */
function providerKeyNames(def: ModelProviderDefinition): (string | undefined)[] {
  const keyNames = Object.keys(getSchemaShape(def.keysSchema));
  const endpointKey = "endpointKey" in def ? def.endpointKey : void 0;
  return keyNames.length > 0 ? keyNames : [def.apiKey, endpointKey];
}

/**
 * Registry keys are all `.nullable().optional()`, so safeParse alone would seed an unusable
 * provider: every non-optional key is required, and Azure needs either mode's endpoint.
 */
function missingProviderKeys({
  provider,
  def,
  names,
  keys,
}: {
  provider: string;
  def: ModelProviderDefinition;
  names: (string | undefined)[];
  keys: Record<string, string>;
}): string[] {
  const optionalKeys = new Set<string>("optionalKeys" in def ? (def.optionalKeys ?? []) : []);
  const missing = names.filter(
    (name): name is string => Boolean(name) && !optionalKeys.has(name ?? "") && !keys[name ?? ""],
  );
  if (provider !== "azure") return missing;
  const endpointNames = ["AZURE_OPENAI_ENDPOINT", "AZURE_API_GATEWAY_BASE_URL"];
  const withoutEndpoints = missing.filter((name) => !endpointNames.includes(name));
  return endpointNames.some((name) => keys[name])
    ? withoutEndpoints
    : [...withoutEndpoints, endpointNames.join(" or ")];
}

async function seedModelProviderFromEnv({
  prisma,
  provider,
  def,
  envMap,
  organizationId,
  encryption,
  allowLoopback,
}: {
  prisma: PrismaClient;
  provider: string;
  def: ModelProviderDefinition;
  envMap: Readonly<Record<string, string | undefined>>;
  organizationId: string;
  encryption: Encryption;
  allowLoopback: boolean;
}): Promise<void> {
  const names = providerKeyNames(def);
  const keys: Record<string, string> = {};
  for (const name of names) {
    const value = name ? envMap[name] : undefined;
    if (name && value) keys[name] = value;
  }
  const missing = missingProviderKeys({ provider, def, names, keys });
  // haven +voice seeds ElevenLabs at voicesim; only the dev switch lets its loopback URL through.
  const keysSchema =
    provider === "elevenlabs" && allowLoopback ? elevenLabsLoopbackKeysSchema : def.keysSchema;
  const parsed = keysSchema.safeParse(keys);
  if (!parsed.success || missing.length > 0) {
    logger.info(
      { provider, apiKeyEnvVar: def.apiKey, missing },
      "model provider skipped: its API key is set but the key set is incomplete",
    );
    return;
  }

  const id = MODEL_PROVIDER_ID_PREFIX + provider;
  const customKeys = encryption.encrypt(JSON.stringify(keys));
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
      modelProviderId: row.id,
    },
    create: {
      modelProviderId: row.id,
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
    },
    update: {},
  });
  logger.info({ provider }, "model provider seeded from the environment");
}

async function seedModelProvidersFromEnv({
  prisma,
  environment,
  organizationId,
  encryption,
}: {
  prisma: PrismaClient;
  environment: Readonly<Record<string, string | undefined>>;
  organizationId: string;
  encryption: Encryption;
}) {
  const flag = environment.HAVEN_SEED_MODEL_PROVIDERS;
  if (flag === "0" || flag === "false") {
    logger.info("model providers: seeding disabled (HAVEN_SEED_MODEL_PROVIDERS=0)");
    return;
  }
  const { voice } = parseProcessConfig({
    owners: [{ name: "voice", config: Config.define(() => ({ allowLoopbackVoiceProviders })) }],
    environment,
  });
  for (const [provider, def] of Object.entries(modelProviders)) {
    // "custom" has no inferable identity from the environment; skip it.
    if (provider === "custom") continue;
    if (!environment[def.apiKey]) continue;
    await seedModelProviderFromEnv({
      prisma,
      provider,
      def,
      envMap: environment,
      organizationId,
      encryption,
      allowLoopback: voice.allowLoopbackVoiceProviders,
    });
  }
}
