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
import { nowInstant, toDate } from "@langwatch/time";

import {
  AgentSandboxKeyUnreadableError,
  type AgentSandboxKeyRepository,
} from "../repositories/agent-sandbox-key.repository.ts";
import {
  AGENT_SANDBOX_KEY_REUSE_MS,
  AGENT_SANDBOX_KEY_TTL_MS,
} from "../rules/agent-sandbox-key.rules.ts";

const logger = createLogger("langwatch:api-key:agent-sandbox");

/**
 * The key a project's code agent runs put in their sandbox (specs/agent-cache/agent-cache.feature):
 * one per project, held sealed and shared for eight hours, minted afresh when none can be read.
 * Two runs on an empty hold may both mint; both keys are valid, the later one is shared.
 */
export class AgentSandboxKeyService {
  static create(options: AgentSandboxKeyServiceOptions): AgentSandboxKeyService {
    return new AgentSandboxKeyService(options);
  }

  private constructor(private readonly options: AgentSandboxKeyServiceOptions) {}

  async mintAgentSandboxKey({ projectId }: MintAgentSandboxKeyInput): Promise<string> {
    const [held] = await this.findHeld(projectId);
    if (held !== undefined) return held;

    const token = await this.mint(projectId);
    await this.options.held.hold({ projectId, token, ttlMs: AGENT_SANDBOX_KEY_REUSE_MS });
    return token;
  }

  private async findHeld(projectId: string): Promise<string[]> {
    try {
      return await this.options.held.findTokens({ projectId });
    } catch (error) {
      if (!(error instanceof AgentSandboxKeyUnreadableError)) throw error;
      logger.warn(
        { projectId },
        "the shared agent sandbox key could not be read; minting a new one",
      );
      return [];
    }
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
  held: AgentSandboxKeyRepository;
}>;
