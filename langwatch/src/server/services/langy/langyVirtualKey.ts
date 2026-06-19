import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { decrypt, encrypt } from "~/utils/encryption";
import { createLogger } from "~/utils/logger/server";
import { resolveAttributionUserId } from "./langyAttribution";
import { backfillLangyCredentialPerProject } from "./langyBackfill";

const logger = createLogger("langwatch:langy:virtual-key");

/**
 * Name under which the auto-provisioned Langy VK secret is stored in
 * ProjectSecret. One row per project.
 *
 * Exported so callers that surface "this is the Langy VK" UI (e.g. the
 * gateway/virtual-keys page) and the backfill reconciler can detect the
 * auto-provisioned key without reinventing the name string.
 */
export const LANGY_VK_SECRET_NAME = "langy_vk_secret";

/**
 * Display name the VK row carries in the gateway/virtual-keys list. Exported
 * for UI heuristics ("is this row the auto-managed Langy VK?").
 */
export const LANGY_VK_DISPLAY_NAME = "Langy";

/**
 * Idempotently provision a Langy VirtualKey for a project + persist its
 * secret to ProjectSecret. Exported so project.create can call it eagerly
 * (so users see the VK in /virtual-keys from day 1) AND the credential
 * service can still self-heal on first chat. Returns the VK secret token.
 *
 * Safe to call multiple times for the same project — the ProjectSecret
 * unique constraint on (projectId, name) plus race-loser retry guarantees
 * one stored secret per project. Orphan VK rows from lost races are
 * acceptable (#4275 v1; cleanup is an admin concern).
 */
export async function provisionLangyVirtualKey(args: {
  prisma: PrismaClient;
  projectId: string;
  organizationId: string;
  /**
   * The user the VK creation is attributed to. Required at runtime (project
   * creation / first-chat self-heal). Optional in the backfill path — we
   * fall back to the org's first admin, same shape as the API key backfill.
   */
  actorUserId?: string | null;
}): Promise<string | null> {
  const { prisma, projectId, organizationId } = args;

  // findFirst (not findUnique-by-projectId_name): the guarded prisma client's
  // multitenancy middleware doesn't recognize the compound key and throws.
  const existing = await prisma.projectSecret.findFirst({
    where: { projectId, name: LANGY_VK_SECRET_NAME },
    select: { encryptedValue: true },
  });
  if (existing) {
    return decrypt(existing.encryptedValue);
  }

  const actorUserId = await resolveAttributionUserId({
    prisma,
    organizationId,
    explicitUserId: args.actorUserId ?? null,
  });
  if (!actorUserId) {
    logger.warn(
      { projectId },
      "no user to attribute the Langy VK to; skipping — credential service will self-heal on first chat once a user signs in",
    );
    return null;
  }

  // Leave modelsAllowed at the schema default (null = all eligible models).
  // We used to seed it from getResolvedDefaultForFeature("prompt.create_default")
  // so the VK "had a model in it" on day 1 — but that resolver can return a
  // model id the gateway has no provider for (the SaaS dev cluster currently
  // resolves to `openai/gpt-5.5`, which the gateway rejects as
  // `model_not_allowed` since it isn't a real OpenAI model). The resulting
  // single-item allowlist then blocks every actual chat. The sidebar picker
  // continues to surface a default via its own feature-key resolution; the
  // VK no longer needs to encode the allowlist defensively at provision time.
  const virtualKeyService = VirtualKeyService.create(prisma);
  const created = await virtualKeyService.create({
    organizationId,
    name: LANGY_VK_DISPLAY_NAME,
    description:
      "Auto-provisioned virtual key for the Langy in-product assistant.",
    principalUserId: null,
    scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
    actorUserId,
  });

  try {
    await prisma.projectSecret.create({
      data: {
        projectId,
        name: LANGY_VK_SECRET_NAME,
        encryptedValue: encrypt(created.secret),
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
    return created.secret;
  } catch (error) {
    // Race: another caller (e.g. concurrent /chat + eager project.create)
    // provisioned + stored first. Our just-created VK is now an orphan but
    // does no harm. Read the winner's secret and return that.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const winner = await prisma.projectSecret.findFirst({
        where: { projectId, name: LANGY_VK_SECRET_NAME },
        select: { encryptedValue: true },
      });
      if (winner) return decrypt(winner.encryptedValue);
    }
    throw error;
  }
}

/**
 * Idempotently provision a Langy VK for every application project that
 * doesn't already have one. Called from `scripts/backfill-langy-virtual-keys.ts`.
 * Mirrors `backfillLangyApiKeys` via the shared per-project sweep.
 */
export async function backfillLangyVirtualKeys(
  prisma: PrismaClient,
  { dryRun = false }: { dryRun?: boolean } = {},
) {
  return await backfillLangyCredentialPerProject({
    prisma,
    dryRun,
    label: "Langy VK",
    logger,
    isProvisioned: async (project) => {
      const existing = await prisma.projectSecret.findFirst({
        where: { projectId: project.id, name: LANGY_VK_SECRET_NAME },
        select: { id: true },
      });
      return Boolean(existing);
    },
    provision: async (project) => {
      const secret = await provisionLangyVirtualKey({
        prisma,
        projectId: project.id,
        organizationId: project.organizationId,
      });
      // No admin to attribute the VK to — counted as skipped, not failed.
      // First chat with a real user will heal this.
      return secret ? "provisioned" : "skipped";
    },
  });
}
