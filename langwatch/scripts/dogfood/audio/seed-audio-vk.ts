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
 */
import { prisma } from "~/server/db";
import { encrypt } from "~/utils/encryption";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { PersonalVirtualKeyService } from "@ee/governance/services/personalVirtualKey.service";

interface Args {
  email: string;
}

function parseArgs(argv: string[]): Args {
  let email = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") email = argv[++i] ?? "";
  }
  if (!email) throw new Error("--email is required");
  return { email };
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
  const existing = await prisma.modelProvider.findFirst({
    where: { organizationId, provider },
    select: { id: true },
  });
  if (existing) {
    await prisma.modelProvider.update({
      where: { id: existing.id },
      data: { enabled: true, customKeys: encrypt(JSON.stringify(keys)) },
    });
    process.stderr.write(`[seed-audio] refreshed ${provider} provider ${existing.id}\n`);
    return existing.id;
  }
  const created = await prisma.modelProvider.create({
    data: {
      name,
      provider,
      enabled: true,
      organizationId,
      customKeys: encrypt(JSON.stringify(keys)),
      scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: organizationId }] },
    },
  });
  process.stderr.write(`[seed-audio] created ${provider} provider ${created.id}\n`);
  return created.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const user = await prisma.user.findFirst({ where: { email: args.email } });
  if (!user) throw new Error(`no user with email ${args.email}, sign up first`);
  // Query through Organization (not OrganizationUser): the tenancy guard
  // requires an org-scoped where clause on membership models, and the
  // org-with-member shape is the sanctioned way to resolve "this user's org".
  const org = await prisma.organization.findFirst({
    where: { members: { some: { userId: user.id } } },
  });
  if (!org) throw new Error(`user ${args.email} belongs to no organization`);
  process.stderr.write(`[seed-audio] user=${user.id} org=${org.id} (${org.name})\n`);

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
    process.stderr.write("[seed-audio] OPENAI_API_KEY unset, skipping openai provider\n");
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
    process.stderr.write("[seed-audio] ELEVENLABS_API_KEY unset, skipping elevenlabs provider\n");
  }
  if (providerIds.length === 0) {
    throw new Error("no provider keys in env, nothing to route");
  }

  // Org-default policy with all providers and NO model allowlist: the
  // audio endpoints route by explicit provider/model, and an allowlist
  // seeded for chat models would reject every audio model id.
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
