/**
 * Audio dogfood seeder: provisions everything the gateway audio endpoints
 * need for a live local run, in one shot:
 *
 *   1. OpenAI + ElevenLabs ModelProvider rows on the user's org (keys from
 *      OPENAI_API_KEY / ELEVENLABS_API_KEY in env; each skipped when unset).
 *   2. An org-default routing policy carrying BOTH providers with NO model
 *      allowlist (audio model ids like gpt-4o-mini-tts and scribe_v1 must
 *      not be filtered by a chat-shaped allowlist).
 *   3. A personal VK for the user, printed once to stdout.
 *
 * Pairs with the live audio matrix cells (services/aigateway/tests/matrix/
 * audio_test.go): export the printed secret as TEST_VK_OPENAI and
 * TEST_VK_ELEVENLABS, and with Scenario-voice dogfooding (OPENAI_BASE_URL
 * pointed at the gateway).
 *
 * Usage:
 *   pnpm tsx scripts/dogfood/audio/seed-audio-vk.ts --email you@example.com
 *
 * Idempotent: reuses existing provider rows (matched by org + provider) and
 * updates the default policy in place.
 *
 * Guardrails, because provider keys and the default policy are org-wide
 * records: refuses to run against a non-local DATABASE_URL unless
 * --allow-remote-db is passed, refuses to wipe a curated default-policy
 * modelAllowlist unless --clear-allowlist is passed, and refuses to pick
 * among multiple org memberships implicitly (pass --org <id or name>).
 */

import { PersonalVirtualKeyService } from "@ee/governance/services/personalVirtualKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { prisma } from "~/server/db";
import { encrypt } from "~/utils/encryption";

interface Args {
  email: string;
  org: string;
  allowRemoteDb: boolean;
  clearAllowlist: boolean;
}

function parseArgs(argv: string[]): Args {
  let email = "";
  let org = "";
  let allowRemoteDb = false;
  let clearAllowlist = false;
  // biome-ignore lint/style/useForOf: flag parser advances the index (argv[++i]) to consume a value; for...of has no index to advance.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") email = argv[++i] ?? "";
    if (argv[i] === "--org") org = argv[++i] ?? "";
    if (argv[i] === "--allow-remote-db") allowRemoteDb = true;
    if (argv[i] === "--clear-allowlist") clearAllowlist = true;
  }
  if (!email) throw new Error("--email is required");
  return { email, org, allowRemoteDb, clearAllowlist };
}

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * This seeder mutates org-wide records (provider keys, the default routing
 * policy), so it only runs against a local database by default. Pointing it
 * at staging or prod by accident would overwrite shared credentials.
 */
function assertLocalDatabase(allowRemoteDb: boolean): void {
  if (allowRemoteDb) return;
  const raw = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error("DATABASE_URL is unset or unparseable, refusing to seed");
  }
  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `DATABASE_URL points at ${host}, not a local database. ` +
        "Re-run with --allow-remote-db if you really mean it.",
    );
  }
}

async function ensureProvider({
  organizationId,
  provider,
  name,
  keys,
}: {
  organizationId: string;
  provider: string;
  name: string;
  keys: Record<string, string>;
}): Promise<string> {
  // Deterministic pick: oldest row first, and be loud when the org carries
  // more than one row for the provider, since only one gets the fresh key.
  const existingRows = await prisma.modelProvider.findMany({
    where: { organizationId, provider },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const existing = existingRows[0];
  if (existing) {
    if (existingRows.length > 1) {
      process.stderr.write(
        `[seed-audio] WARNING: ${existingRows.length} ${provider} provider rows on this org, refreshing the oldest (${existing.id}) and leaving the rest untouched\n`,
      );
    }
    await prisma.modelProvider.update({
      where: { id: existing.id },
      data: { enabled: true, customKeys: encrypt(JSON.stringify(keys)) },
    });
    process.stderr.write(
      `[seed-audio] refreshed ${provider} provider ${existing.id}\n`,
    );
    return existing.id;
  }
  const created = await prisma.modelProvider.create({
    data: {
      name,
      provider,
      enabled: true,
      organizationId,
      customKeys: encrypt(JSON.stringify(keys)),
      scopes: {
        create: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
      },
    },
  });
  process.stderr.write(
    `[seed-audio] created ${provider} provider ${created.id}\n`,
  );
  return created.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertLocalDatabase(args.allowRemoteDb);

  const user = await prisma.user.findFirst({ where: { email: args.email } });
  if (!user) throw new Error(`no user with email ${args.email}, sign up first`);
  // Query through Organization (not OrganizationUser): the tenancy guard
  // requires an org-scoped where clause on membership models, and the
  // org-with-member shape is the sanctioned way to resolve "this user's org".
  // Never pick among multiple memberships implicitly: seeding the wrong
  // tenant would plant credentials and a default policy on someone else's
  // org, so ambiguity requires an explicit --org.
  const orgs = await prisma.organization.findMany({
    where: { members: { some: { userId: user.id } } },
    select: { id: true, name: true },
  });
  if (orgs.length === 0) {
    throw new Error(`user ${args.email} belongs to no organization`);
  }
  let org: { id: string; name: string };
  if (args.org) {
    const picked = orgs.find((o) => o.id === args.org || o.name === args.org);
    if (!picked) {
      throw new Error(
        `--org ${args.org} does not match any of ${args.email}'s organizations: ` +
          orgs.map((o) => `${o.name} [${o.id}]`).join(", "),
      );
    }
    org = picked;
  } else if (orgs.length === 1) {
    org = orgs[0]!;
  } else {
    throw new Error(
      `user ${args.email} belongs to ${orgs.length} organizations, pass --org <id or name>: ` +
        orgs.map((o) => `${o.name} [${o.id}]`).join(", "),
    );
  }
  process.stderr.write(
    `[seed-audio] user=${user.id} org=${org.id} (${org.name})\n`,
  );

  const providerIds: string[] = [];
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    providerIds.push(
      await ensureProvider({
        organizationId: org.id,
        provider: "openai",
        name: "OpenAI",
        keys: { OPENAI_API_KEY: openaiKey },
      }),
    );
  } else {
    process.stderr.write(
      "[seed-audio] OPENAI_API_KEY unset, skipping openai provider\n",
    );
  }
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (elevenKey) {
    providerIds.push(
      await ensureProvider({
        organizationId: org.id,
        provider: "elevenlabs",
        name: "ElevenLabs",
        keys: { ELEVENLABS_API_KEY: elevenKey },
      }),
    );
  } else {
    process.stderr.write(
      "[seed-audio] ELEVENLABS_API_KEY unset, skipping elevenlabs provider\n",
    );
  }
  if (providerIds.length === 0) {
    throw new Error("no provider keys in env, nothing to route");
  }

  // Org-default policy with all providers and NO model allowlist: the
  // audio endpoints route by explicit provider/model, and an allowlist
  // seeded for chat models would reject every audio model id.
  const existingPolicy = await prisma.routingPolicy.findFirst({
    where: { organizationId: org.id, isDefault: true },
    select: { id: true, modelProviderIds: true, modelAllowlist: true },
  });
  if (existingPolicy) {
    // A curated allowlist on the existing default policy is someone's
    // deliberate restriction; wiping it silently would lift model limits
    // for every caller in the org. Require the explicit flag.
    const hasCuratedAllowlist =
      Array.isArray(existingPolicy.modelAllowlist) &&
      existingPolicy.modelAllowlist.length > 0;
    if (hasCuratedAllowlist && !args.clearAllowlist) {
      throw new Error(
        `default policy ${existingPolicy.id} has a curated modelAllowlist, ` +
          "which would reject audio model ids. Re-run with --clear-allowlist " +
          "to clear it, or add the audio models to the allowlist yourself.",
      );
    }
    // modelProviderIds is a Json column, so Prisma types it as JsonValue.
    const priorIds = Array.isArray(existingPolicy.modelProviderIds)
      ? existingPolicy.modelProviderIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [];
    const merged = Array.from(new Set([...priorIds, ...providerIds]));
    await prisma.routingPolicy.update({
      where: { id: existingPolicy.id },
      data: { modelProviderIds: merged, modelAllowlist: [] },
    });
    process.stderr.write(
      `[seed-audio] updated default policy ${existingPolicy.id}: providers=${merged.length} allowlist cleared\n`,
    );
  } else {
    const policy = await prisma.routingPolicy.create({
      data: {
        organizationId: org.id,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: org.id }] },
        name: "audio-dogfood-default",
        isDefault: true,
        strategy: "priority",
        modelProviderIds: providerIds,
        modelAllowlist: [],
      },
    });
    process.stderr.write(`[seed-audio] created default policy ${policy.id}\n`);
  }

  const workspaceSvc = new PersonalWorkspaceService(prisma);
  const workspace = await workspaceSvc.ensure({
    userId: user.id,
    organizationId: org.id,
    displayName: user.name ?? null,
    displayEmail: user.email ?? args.email,
  });

  const vkSvc = PersonalVirtualKeyService.create(prisma, {
    gatewayBaseUrl: process.env.LW_GATEWAY_BASE_URL ?? "http://localhost:5563",
  });
  const issued = await vkSvc.issue({
    userId: user.id,
    organizationId: org.id,
    personalProjectId: workspace.project.id,
    personalTeamId: workspace.team.id,
    label: "audio-dogfood",
  });

  process.stdout.write(
    JSON.stringify(
      {
        vk: issued.secret,
        vkId: issued.id,
        baseUrl: issued.baseUrl,
        projectId: workspace.project.id,
        providers: providerIds.length,
      },
      null,
      2,
    ) + "\n",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
