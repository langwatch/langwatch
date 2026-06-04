import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { encrypt, decrypt } from "~/utils/encryption";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { provisionLangyApiKey, getLangyApiKeyToken } from "./langyApiKey";

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
  actorUserId: string;
}): Promise<string> {
  const { prisma, projectId, organizationId, actorUserId } = args;

  // findFirst (not findUnique-by-projectId_name): the guarded prisma client's
  // multitenancy middleware doesn't recognize the compound key and throws.
  const existing = await prisma.projectSecret.findFirst({
    where: { projectId, name: LANGY_VK_SECRET_NAME },
    select: { encryptedValue: true },
  });
  if (existing) {
    return decrypt(existing.encryptedValue);
  }

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
    // eager project.create path share one implementation.
    return provisionLangyVirtualKey({
      prisma: this.prisma,
      ...args,
    });
  }
}
