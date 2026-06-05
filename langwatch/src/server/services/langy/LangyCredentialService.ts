import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { encrypt, decrypt } from "~/utils/encryption";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { provisionLangyApiKey, getLangyApiKeyToken } from "./langyApiKey";
import { getResolvedDefaultForFeature } from "~/server/modelProviders/modelDefaults.read";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:langy:credential");

/**
 * Feature key whose cascade-resolved model we seed onto the Langy VK's
 * `modelsAllowed` at provision time. Same key the sidebar picker seeds
 * itself from (LangySidebar's LANGY_GATE_FEATURE_KEY) so the VK and the
 * composer agree on "the model Langy uses by default".
 */
const LANGY_VK_MODEL_FEATURE_KEY = "prompt.create_default";

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

  // ProjectSecret + VirtualKey audit fields require a user. When the caller
  // doesn't have one (backfill), fall back to the org's first admin — same
  // resolution the API key backfill uses (langyApiKey.ts:resolveCreatorId).
  const actorUserId = await resolveActorUserId(
    prisma,
    organizationId,
    args.actorUserId ?? null,
  );
  if (!actorUserId) {
    logger.warn(
      { projectId },
      "no user to attribute the Langy VK to; skipping — credential service will self-heal on first chat once a user signs in",
    );
    return null;
  }

  // Seed the VK's model allowlist with whatever the project currently
  // resolves as its default chat model, so the VK "has a model in it" from
  // day 1 and the sidebar picker starts narrowed to it. At a fresh
  // project.create there's usually no provider yet → this resolves to null
  // and we leave modelsAllowed null (= "all eligible models"). It fires when
  // an org/team default is inherited, and on the self-heal / backfill paths.
  // getResolvedDefaultForFeature returns null instead of throwing when
  // nothing is configured, so a missing default never breaks provisioning.
  const resolvedDefault = await getResolvedDefaultForFeature(
    // ReadCtx wants a session, but this resolver only reads ctx.prisma;
    // provisioning runs without a user session, so null is correct.
    { prisma, session: null },
    { projectId, featureKey: LANGY_VK_MODEL_FEATURE_KEY },
  );
  const modelsAllowed = resolvedDefault?.model
    ? [resolvedDefault.model]
    : null;

  // GatewayProviderCredential was removed in iter 110 — VKs route through the
  // project's ModelProviders. The /chat route's model gate handles "no model
  // configured" with a 409 before we get here, so we don't validate here.
  const virtualKeyService = VirtualKeyService.create(prisma);
  const created = await virtualKeyService.create({
    organizationId,
    name: LANGY_VK_DISPLAY_NAME,
    description:
      "Auto-provisioned virtual key for the Langy in-product assistant.",
    principalUserId: null,
    scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
    actorUserId,
    // Omit config entirely when nothing resolved so the VK keeps the schema
    // default (modelsAllowed: null = all). Only set it when we have a seed.
    ...(modelsAllowed ? { config: { modelsAllowed } } : {}),
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
 * Thrown when credential resolution can't complete — missing project,
 * missing provider credential, missing env config. The /chat route turns
 * these into 409s so the user gets a clear actionable error rather than
 * a generic 500.
 */
export class LangyCredentialResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LangyCredentialResolutionError";
  }
}

export type LangyCredentials = {
  /** Project's sk-lw-* key. Used by the MCP server in the worker to call the LW API. */
  langwatchApiKey: string;
  /** Project's Langy VK secret. Used by opencode as OPENAI_API_KEY against the AI gateway. */
  llmVirtualKey: string;
  /** Control plane base URL — set as LANGWATCH_ENDPOINT for the MCP server. */
  langwatchEndpoint: string;
  /** AI gateway base URL — set as OPENAI_BASE_URL for opencode. */
  gatewayBaseUrl: string;
};

/**
 * Resolves the credentials a Langy worker subprocess needs in its env.
 *
 * Per-project model: one Langy VK is auto-provisioned on first use and
 * stored encrypted in ProjectSecret. All Langy chats in that project
 * share that VK. Cost attribution is per-project, not per-user — when
 * we want per-user attribution we'll add a per-user secret store.
 */
export class LangyCredentialService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly virtualKeyService: VirtualKeyService,
  ) {}

  static create(prisma: PrismaClient): LangyCredentialService {
    return new LangyCredentialService(
      prisma,
      VirtualKeyService.create(prisma),
    );
  }

  async getOrProvision({
    projectId,
    actorUserId,
  }: {
    projectId: string;
    actorUserId: string;
  }): Promise<LangyCredentials> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        apiKey: true,
        team: { select: { organizationId: true } },
      },
    });
    if (!project) {
      throw new LangyCredentialResolutionError(
        `Project ${projectId} not found.`,
      );
    }

    const langwatchEndpoint = process.env.LANGWATCH_API_URL;
    const gatewayBaseUrl = process.env.LW_GATEWAY_BASE_URL;
    if (!langwatchEndpoint) {
      throw new LangyCredentialResolutionError(
        "LANGWATCH_API_URL is not configured on the control plane.",
      );
    }
    if (!gatewayBaseUrl) {
      throw new LangyCredentialResolutionError(
        "LW_GATEWAY_BASE_URL is not configured on the control plane.",
      );
    }

    // Prefer the dedicated, least-privilege "Langy" key over the human's
    // ingestion key. Provision-on-first-use makes it self-healing if project
    // creation / backfill missed it; we fall back to project.apiKey only when
    // no token could be stored (e.g. no resolvable user to attribute it to).
    await provisionLangyApiKey({
      prisma: this.prisma,
      projectId,
      organizationId: project.team.organizationId,
      createdByUserId: actorUserId,
    });
    const langyApiKeyToken = await getLangyApiKeyToken(this.prisma, projectId);

    const llmVirtualKey = await this.getOrProvisionVirtualKey({
      projectId,
      organizationId: project.team.organizationId,
      actorUserId,
    });

    return {
      langwatchApiKey: langyApiKeyToken ?? project.apiKey,
      llmVirtualKey,
      langwatchEndpoint,
      gatewayBaseUrl,
    };
  }

  private async getOrProvisionVirtualKey(args: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<string> {
    // Delegates to the standalone helper so /chat-time self-healing and the
    // eager project.create path share one implementation. At chat time we
    // always have an authenticated user, so the helper's null fallback path
    // is unreachable here — assert non-null to satisfy the caller's type.
    const secret = await provisionLangyVirtualKey({
      prisma: this.prisma,
      ...args,
    });
    if (!secret) {
      throw new LangyCredentialResolutionError(
        "Failed to provision Langy virtual key — no actor user could be resolved.",
      );
    }
    return secret;
  }
}

async function resolveActorUserId(
  prisma: PrismaClient,
  organizationId: string,
  explicit: string | null,
): Promise<string | null> {
  if (explicit) return explicit;
  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return admin?.userId ?? null;
}

/**
 * Idempotently provision a Langy VK for every application project that
 * doesn't already have one. Called from `scripts/backfill-langy-virtual-keys.ts`.
 * Mirrors the shape of `backfillLangyApiKeys` for symmetry.
 */
export async function backfillLangyVirtualKeys(
  prisma: PrismaClient,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ provisioned: number; skipped: number; failed: number }> {
  // Only real user workspaces — hidden internal_governance routing projects
  // are not user-facing and must never receive a Langy VK.
  const projects = await prisma.project.findMany({
    where: { kind: "application" },
    select: { id: true, team: { select: { organizationId: true } } },
  });

  let provisioned = 0;
  let skipped = 0;
  let failed = 0;

  for (const project of projects) {
    const existing = await prisma.projectSecret.findFirst({
      where: { projectId: project.id, name: LANGY_VK_SECRET_NAME },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    if (dryRun) {
      provisioned++;
      continue;
    }
    try {
      const secret = await provisionLangyVirtualKey({
        prisma,
        projectId: project.id,
        organizationId: project.team.organizationId,
      });
      if (secret) {
        provisioned++;
      } else {
        // No admin to attribute the VK to — counted as skipped, not failed.
        // First chat with a real user will heal this.
        skipped++;
      }
    } catch (err) {
      failed++;
      logger.error(
        { err, projectId: project.id },
        "failed to backfill Langy VK for project",
      );
    }
  }

  logger.info(
    { provisioned, skipped, failed, dryRun },
    "Langy VK backfill complete",
  );
  return { provisioned, skipped, failed };
}
