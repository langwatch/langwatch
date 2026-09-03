/**
 * Audio dogfood seeder: provisions everything the gateway audio endpoints
 * need for a live local run, in one shot:
 *
 *   1. OpenAI + ElevenLabs ModelProvider rows on the user's org (keys from
 *      OPENAI_API_KEY / ELEVENLABS_API_KEY in env; each skipped when unset).
 *      Read those from platform/app/.env, which is where this app's model
 *      provider keys live. An env file from another repository drifts, and
 *      a stale key is indistinguishable from a fresh one once stored.
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
 * --allow-remote-db is passed, refuses to pick among multiple org
 * memberships implicitly (pass --org <id or name>), and never replaces a
 * provider credential that is already stored unless --force-keys is passed.
 * A development org is shared, and the key it was using cannot be recovered
 * once overwritten.
 */

import { PersonalVirtualKeyService } from "@ee/governance/services/personalVirtualKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { prisma } from "~/server/db";
import {
  credentialWriteLog,
  decideCredentialWrite,
  keepHint,
  readStoredCredential,
  skipHint,
} from "~/server/modelProviders/seedProviderCredential";
import { encrypt } from "~/utils/encryption";

interface Args {
  email: string;
  org: string;
  allowRemoteDb: boolean;
  shouldForceKeys: boolean;
}

function parseArgs(argv: string[]): Args {
  let email = "";
  let org = "";
  let allowRemoteDb = false;
  let shouldForceKeys = false;
  // biome-ignore lint/style/useForOf: flag parser advances the index (argv[++i]) to consume a value; for...of has no index to advance.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") email = argv[++i] ?? "";
    if (argv[i] === "--org") org = argv[++i] ?? "";
    if (argv[i] === "--allow-remote-db") allowRemoteDb = true;
    if (argv[i] === "--force-keys") shouldForceKeys = true;
  }
  if (!email) throw new Error("--email is required");
  return { email, org, allowRemoteDb, shouldForceKeys };
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
  shouldForceKeys,
}: {
  organizationId: string;
  provider: string;
  name: string;
  /** Null when the provider's environment variable is unset on this run. */
  keys: Record<string, string> | null;
  shouldForceKeys: boolean;
}): Promise<{ id: string; usable: boolean } | null> {
  // Deterministic pick: oldest row first, and be loud when the org carries
  // more than one row for the provider, since only one is considered.
  const existingRows = await prisma.modelProvider.findMany({
    where: { organizationId, provider },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, customKeys: true },
  });
  const existing = existingRows[0];
  if (existing) {
    if (existingRows.length > 1) {
      process.stderr.write(
        `[seed-audio] WARNING: ${existingRows.length} ${provider} provider rows on this org, using the oldest (${existing.id}) and leaving the rest untouched\n`,
      );
    }
    const stored = readStoredCredential(existing.customKeys);
    const decision = decideCredentialWrite({
      stored,
      replacement: keys,
      shouldForce: shouldForceKeys,
    });
    process.stderr.write(
      credentialWriteLog({
        tag: "seed-audio",
        organizationId,
        provider,
        modelProviderId: existing.id,
        stored,
        incoming: keys ?? {},
        decision,
      }),
    );
    if (decision.action === "skip") {
      // The row cannot serve a request: either nothing can decrypt it, or it
      // has no credential and this run has none to give it. Enabling it would
      // put a provider in the routing chain that fails at credential
      // materialisation on every request, which reads as the gateway being
      // broken rather than as this row needing attention.
      process.stderr.write(skipHint("seed-audio", decision.reason));
      return { id: existing.id, usable: false };
    }
    if (decision.action === "keep") {
      process.stderr.write(keepHint("seed-audio"));
      // Enabling a row that already has a key is safe and is what the rest
      // of the seed needs; only the credential is left alone.
      await prisma.modelProvider.update({
        where: { id: existing.id },
        data: { enabled: true },
      });
      return { id: existing.id, usable: true };
    }
    // Only a `write` reaches here, and the rule never returns one without a
    // replacement in hand.
    await prisma.modelProvider.update({
      where: { id: existing.id },
      data: { enabled: true, customKeys: encrypt(JSON.stringify(keys)) },
    });
    return { id: existing.id, usable: true };
  }

  // No row for this provider. With no key in hand there is nothing to create,
  // and creating an empty row would add a provider the gateway cannot build a
  // credential for.
  if (!keys) {
    process.stderr.write(
      `[seed-audio] no ${provider} provider row and no key in env, nothing to seed\n`,
    );
    return null;
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
  return { id: created.id, usable: true };
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

  // A skipped row stays out of the policy, so the chain never carries a
  // provider the gateway cannot build a credential for. Its id is remembered
  // too, because an earlier run may already have put it in the policy and a
  // merge that only adds would leave it there.
  const providerIds: string[] = [];
  const unusableIds: string[] = [];

  // An unset environment variable is not a reason to ignore a provider the
  // organization already has. The row is still consulted, and a readable
  // stored credential keeps the provider in the chain; only a row that cannot
  // serve a request drops out. Skipping the lookup entirely used to fail the
  // whole run against an organization that was already configured.
  for (const candidate of [
    {
      provider: "openai",
      name: "OpenAI",
      envVar: "OPENAI_API_KEY",
      value: process.env.OPENAI_API_KEY,
    },
    {
      provider: "elevenlabs",
      name: "ElevenLabs",
      envVar: "ELEVENLABS_API_KEY",
      value: process.env.ELEVENLABS_API_KEY,
    },
  ]) {
    if (!candidate.value) {
      process.stderr.write(
        `[seed-audio] ${candidate.envVar} unset, keeping whatever ${candidate.provider} credential the org already holds\n`,
      );
    }
    const seeded = await ensureProvider({
      organizationId: org.id,
      provider: candidate.provider,
      name: candidate.name,
      keys: candidate.value ? { [candidate.envVar]: candidate.value } : null,
      shouldForceKeys: args.shouldForceKeys,
    });
    if (!seeded) continue;
    (seeded.usable ? providerIds : unusableIds).push(seeded.id);
  }

  if (providerIds.length === 0) {
    throw new Error(
      "no usable provider rows: no key was in env and the org holds no readable credential for either provider",
    );
  }

  // Org-default policy carrying every provider: the audio endpoints route
  // by explicit provider/model.
  const existingPolicy = await prisma.routingPolicy.findFirst({
    where: { organizationId: org.id, isDefault: true },
    select: { id: true, modelProviderIds: true },
  });
  if (existingPolicy) {
    // modelProviderIds is a Json column, so Prisma types it as JsonValue.
    const priorIds = Array.isArray(existingPolicy.modelProviderIds)
      ? existingPolicy.modelProviderIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [];
    // Adding this run's providers is not enough: a provider the policy
    // already names may have become unreadable since, and leaving it in the
    // chain sends traffic to a credential that cannot materialise.
    const merged = Array.from(new Set([...priorIds, ...providerIds])).filter(
      (id) => !unusableIds.includes(id),
    );
    await prisma.routingPolicy.update({
      where: { id: existingPolicy.id },
      data: { modelProviderIds: merged },
    });
    process.stderr.write(
      `[seed-audio] updated default policy ${existingPolicy.id}: providers=${merged.length}\n`,
    );
  } else {
    const policy = await prisma.routingPolicy.create({
      data: {
        organizationId: org.id,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: org.id }] },
        name: "audio-dogfood-default",
        isDefault: true,
        modelProviderIds: providerIds,
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
