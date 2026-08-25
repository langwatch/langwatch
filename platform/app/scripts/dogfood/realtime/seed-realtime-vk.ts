/**
 * Realtime voice dogfood seeder. Provisions, in one shot, everything a live
 * broker run needs:
 *
 *   1. OpenAI + ElevenLabs ModelProvider rows on the user's organization,
 *      keys read from OPENAI_API_KEY / ELEVENLABS_API_KEY. The ElevenLabs
 *      row also carries ELEVENLABS_WEBHOOK_SECRET when it is set, which is
 *      what lets the post-call webhook be verified.
 *   2. An organization-default routing policy carrying both providers with no
 *      model allowlist.
 *   3. A personal virtual key with a realtime session cap, printed once.
 *   4. A dedicated budget on that key, so a spend delta is attributable to
 *      this run and nothing else.
 *
 * Usage:
 *   pnpm tsx scripts/dogfood/realtime/seed-realtime-vk.ts --email you@example.com
 *   pnpm tsx scripts/dogfood/realtime/seed-realtime-vk.ts --email … --max-open-sessions 1
 *
 * Steps 1 and 2 are idempotent: provider rows are matched by organization and
 * provider, and the default policy is updated in place.
 *
 * Steps 3 and 4 are NOT. `PersonalVirtualKeyService.issue()` mints a new key
 * every run, because the plaintext secret exists only at mint and an existing
 * key cannot be printed again, and each run's budget is scoped to that new
 * key. So every run leaves behind one more key and one more blocking budget.
 * Delete the keys from a previous run before re-seeding, or the organization
 * accumulates them.
 *
 * Refuses to run against a non-local DATABASE_URL unless --allow-remote-db is
 * passed: provider keys and the default policy are organization-wide records.
 */

import { prisma } from "~/server/db";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import { encrypt } from "~/utils/encryption";

interface Args {
  email: string;
  org: string;
  maxOpenSessions: number | null;
  budgetUsd: string;
  allowRemoteDb: boolean;
}

function parseArgs({ argv }: { argv: string[] }): Args {
  let email = "";
  let org = "";
  let maxOpenSessions: number | null = null;
  let budgetUsd = "5";
  let allowRemoteDb = false;
  // biome-ignore lint/style/useForOf: the parser advances the index to consume a value.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") email = argv[++i] ?? "";
    if (argv[i] === "--org") org = argv[++i] ?? "";
    if (argv[i] === "--max-open-sessions") {
      maxOpenSessions = Number.parseInt(argv[++i] ?? "", 10);
    }
    if (argv[i] === "--budget-usd") budgetUsd = argv[++i] ?? "5";
    if (argv[i] === "--allow-remote-db") allowRemoteDb = true;
  }
  if (!email) throw new Error("--email is required");
  return { email, org, maxOpenSessions, budgetUsd, allowRemoteDb };
}

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function assertLocalDatabase({
  allowRemoteDb,
}: {
  allowRemoteDb: boolean;
}): void {
  if (allowRemoteDb) return;
  let host = "";
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    throw new Error("DATABASE_URL is unset or unparseable, refusing to seed");
  }
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `DATABASE_URL points at ${host}, not a local database. Re-run with --allow-remote-db if you really mean it.`,
    );
  }
}

async function ensureProvider(params: {
  organizationId: string;
  provider: string;
  name: string;
  keys: Record<string, string>;
}): Promise<string> {
  const rows = await prisma.modelProvider.findMany({
    where: { organizationId: params.organizationId, provider: params.provider },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const existing = rows[0];
  if (existing) {
    if (rows.length > 1) {
      process.stderr.write(
        `[seed-realtime] WARNING: ${rows.length} ${params.provider} rows on this org, refreshing the oldest (${existing.id})\n`,
      );
    }
    await prisma.modelProvider.update({
      where: { id: existing.id },
      data: { enabled: true, customKeys: encrypt(JSON.stringify(params.keys)) },
    });
    process.stderr.write(
      `[seed-realtime] refreshed ${params.provider} provider ${existing.id}\n`,
    );
    return existing.id;
  }
  const created = await prisma.modelProvider.create({
    data: {
      name: params.name,
      provider: params.provider,
      enabled: true,
      organizationId: params.organizationId,
      customKeys: encrypt(JSON.stringify(params.keys)),
      scopes: {
        create: [{ scopeType: "ORGANIZATION", scopeId: params.organizationId }],
      },
    },
  });
  process.stderr.write(
    `[seed-realtime] created ${params.provider} provider ${created.id}\n`,
  );
  return created.id;
}

async function main() {
  const args = parseArgs({ argv: process.argv.slice(2) });
  assertLocalDatabase({ allowRemoteDb: args.allowRemoteDb });

  const user = await prisma.user.findFirst({ where: { email: args.email } });
  if (!user) throw new Error(`no user with email ${args.email}, sign up first`);
  const orgs = await prisma.organization.findMany({
    where: { members: { some: { userId: user.id } } },
    select: { id: true, name: true },
  });
  if (orgs.length === 0) {
    throw new Error(`user ${args.email} belongs to no organization`);
  }
  const org = args.org
    ? orgs.find((o) => o.id === args.org || o.name === args.org)
    : orgs.length === 1
      ? orgs[0]
      : undefined;
  if (!org) {
    throw new Error(
      `pass --org <id or name>; ${args.email} belongs to: ` +
        orgs.map((o) => `${o.name} [${o.id}]`).join(", "),
    );
  }
  process.stderr.write(`[seed-realtime] user=${user.id} org=${org.id}\n`);

  const providerIds: string[] = [];
  let elevenLabsProviderId = "";
  if (process.env.OPENAI_API_KEY) {
    providerIds.push(
      await ensureProvider({
        organizationId: org.id,
        provider: "openai",
        name: "OpenAI",
        keys: { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
      }),
    );
  }
  if (process.env.ELEVENLABS_API_KEY) {
    elevenLabsProviderId = await ensureProvider({
      organizationId: org.id,
      provider: "elevenlabs",
      name: "ElevenLabs",
      keys: {
        ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
        ...(process.env.ELEVENLABS_WEBHOOK_SECRET
          ? { ELEVENLABS_WEBHOOK_SECRET: process.env.ELEVENLABS_WEBHOOK_SECRET }
          : {}),
        ...(process.env.ELEVENLABS_BASE_URL
          ? { ELEVENLABS_BASE_URL: process.env.ELEVENLABS_BASE_URL }
          : {}),
      },
    });
    providerIds.push(elevenLabsProviderId);
  }
  if (providerIds.length === 0) {
    throw new Error("no provider keys in env, nothing to route");
  }

  const existingPolicy = await prisma.routingPolicy.findFirst({
    where: { organizationId: org.id, isDefault: true },
    select: { id: true, modelProviderIds: true },
  });
  if (existingPolicy) {
    const prior = Array.isArray(existingPolicy.modelProviderIds)
      ? existingPolicy.modelProviderIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [];
    await prisma.routingPolicy.update({
      where: { id: existingPolicy.id },
      data: {
        modelProviderIds: Array.from(new Set([...prior, ...providerIds])),
      },
    });
  } else {
    await prisma.routingPolicy.create({
      data: {
        organizationId: org.id,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: org.id }] },
        name: "realtime-dogfood-default",
        isDefault: true,
        modelProviderIds: providerIds,
      },
    });
  }

  const app = initializeDefaultApp({ processRole: "web" });
  const workspace = await app.organizations.ensurePersonalWorkspace({
    userId: user.id,
    organizationId: org.id,
    displayName: user.name ?? null,
    displayEmail: user.email ?? args.email,
  });
  const minted = await app.governance.personalVirtualKeys.issue({
    userId: user.id,
    organizationId: org.id,
    personalProjectId: workspace.project.id,
    personalTeamId: workspace.team.id,
    label: "realtime-dogfood",
  });

  await prisma.virtualKey.update({
    where: { id: minted.id },
    data: {
      config: {
        modelsAllowed: null,
        providersAllowed: null,
        cache: { mode: "respect", ttlS: 3600 },
        fallback: { maxAttempts: 3 },
        guardrailAttachments: [],
        rateLimits: { rpm: null, tpm: null, rpd: null },
        realtime: { maxOpenSessions: args.maxOpenSessions },
        metadata: { tags: ["realtime-dogfood"] },
      },
    },
  });

  const budget = await prisma.gatewayBudget.create({
    data: {
      organizationId: org.id,
      scopeType: "VIRTUAL_KEY",
      scopeId: minted.id,
      name: `realtime-dogfood-${minted.id}`,
      window: "TOTAL",
      limitUsd: args.budgetUsd,
      onBreach: "BLOCK",
      resetsAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      createdById: user.id,
      managedByVirtualKeyId: minted.id,
    },
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        virtual_key: minted.secret,
        virtual_key_id: minted.id,
        organization_id: org.id,
        project_id: workspace.project.id,
        gateway_base_url: minted.baseUrl,
        elevenlabs_model_provider_id: elevenLabsProviderId || null,
        budget_id: budget.id,
        max_open_sessions: args.maxOpenSessions,
      },
      null,
      2,
    )}\n`,
  );
}

main()
  .catch((err: unknown) => {
    process.stderr.write(`[seed-realtime] ${String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
