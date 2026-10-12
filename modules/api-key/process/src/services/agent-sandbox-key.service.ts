import {
  AGENT_SANDBOX_API_KEY_NAME,
  AGENT_SANDBOX_PERMISSIONS,
  ApiKeyScopeViolationError,
  type ApiKeyApi,
  type MintAgentSandboxKeyInput,
} from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import { mintOnce, type SharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { nowInstant, toDate } from "@langwatch/time";

import {
  AGENT_SANDBOX_KEY_REUSE_MS,
  AGENT_SANDBOX_KEY_TTL_MS,
} from "../rules/agent-sandbox-key.rules.ts";

const logger = createLogger("langwatch:api-key:agent-sandbox");

/**
 * The key a project's code agent runs put in their sandbox (specs/agent-cache/agent-cache.feature):
 * one per project, held sealed and shared for eight hours, minted afresh when none can be read.
 * Minted once across every server (`mintOnce`): runs starting together share the one key.
 */
export class AgentSandboxKeyService {
  static create(options: AgentSandboxKeyServiceOptions): AgentSandboxKeyService {
    return new AgentSandboxKeyService(options);
  }

  private constructor(private readonly options: AgentSandboxKeyServiceOptions) {}

  async mintAgentSandboxKey({ projectId }: MintAgentSandboxKeyInput): Promise<string> {
    return mintOnce({
      store: this.options.held,
      address: { tenantId: projectId },
      onUnreadable: () =>
        logger.warn(
          { projectId },
          "the shared agent sandbox key could not be read; minting a new one",
        ),
      mint: async () => ({ value: await this.mint(projectId), ttlMs: AGENT_SANDBOX_KEY_REUSE_MS }),
    });
  }

  // Nobody's key in a shared project; the owner's in a personal workspace, which admits no other
  // principal. A personal workspace with no recorded owner is refused, failing closed as main did.
  private async mint(projectId: string): Promise<string> {
    const scope = await this.options.authz.getScope({ projectId });
    if (scope.type !== "project") {
      throw new ApiKeyScopeViolationError("A sandbox key is bound to an existing project");
    }
    const { organizationId } = scope;
    const personal = await this.options.projects.findPersonalWorkspaceOwner({
      organizationId,
      scopeId: projectId,
    });
    const ownerUserId = personal?.ownerUserId ?? null;
    if (personal && ownerUserId === null) {
      throw new ApiKeyScopeViolationError(
        "Personal workspace scopes may only be granted to their owner",
      );
    }

    const { token } = await this.options.apiKeys.create({
      isSystemManaged: true,
      name: AGENT_SANDBOX_API_KEY_NAME,
      description:
        "Short-lived key shared by the code agent runs of one project. Reaches the project's " +
        "agent cache and nothing else, and expires by itself.",
      userId: ownerUserId,
      createdByUserId: ownerUserId,
      organizationId,
      permissionMode: "restricted",
      permissions: [...AGENT_SANDBOX_PERMISSIONS],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
      expiresAt: toDate(nowInstant().add({ milliseconds: AGENT_SANDBOX_KEY_TTL_MS })),
    });

    return token;
  }
}

type AgentSandboxKeyServiceOptions = Readonly<{
  apiKeys: Pick<ApiKeyApi, "create">;
  authz: Pick<AuthzApi, "getScope">;
  projects: Pick<ProjectApi, "findPersonalWorkspaceOwner">;
  held: SharedCredentialStore;
}>;
