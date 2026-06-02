import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { encrypt, decrypt } from "~/utils/encryption";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";

/**
 * Name under which the auto-provisioned Langy VK secret is stored in
 * ProjectSecret. One row per project.
 */
const LANGY_VK_SECRET_NAME = "langy_vk_secret";

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

    const llmVirtualKey = await this.getOrProvisionVirtualKey({
      projectId,
      organizationId: project.team.organizationId,
      actorUserId,
    });

    return {
      langwatchApiKey: project.apiKey,
      llmVirtualKey,
      langwatchEndpoint,
      gatewayBaseUrl,
    };
  }

  private async getOrProvisionVirtualKey({
    projectId,
    organizationId,
    actorUserId,
  }: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<string> {
    const existing = await this.prisma.projectSecret.findUnique({
      where: {
        projectId_name: { projectId, name: LANGY_VK_SECRET_NAME },
      },
      select: { encryptedValue: true },
    });
    if (existing) {
      return decrypt(existing.encryptedValue);
    }

    // GatewayProviderCredential was removed in iter 110 — virtual keys are now
    // scoped to a project and route through that project's ModelProviders, so
    // there's no provider-credential row to look up or bind here. The /chat
    // route already guards model availability via getVercelAIModel before we
    // reach provisioning, so a project without a configured model fails there
    // with a clear 409 rather than here.
    const created = await this.virtualKeyService.create({
      organizationId,
      name: "Langy",
      description:
        "Auto-provisioned virtual key for the Langy in-product assistant.",
      principalUserId: null,
      scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      actorUserId,
    });

    try {
      await this.prisma.projectSecret.create({
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
      // Race: another /chat request for the same project provisioned + stored
      // first. The VK we just created is now an orphan (no ProjectSecret row
      // points at it), but it does no harm — we read the winner's secret and
      // return that. The orphan is acceptable for v1; an admin can clean it
      // up via the gateway UI if it ever matters.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const winner = await this.prisma.projectSecret.findUnique({
          where: {
            projectId_name: { projectId, name: LANGY_VK_SECRET_NAME },
          },
          select: { encryptedValue: true },
        });
        if (winner) return decrypt(winner.encryptedValue);
      }
      throw error;
    }
  }
}
