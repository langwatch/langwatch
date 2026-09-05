/**
 * The credential a code agent's sandbox authenticates with.
 */
import { AGENT_SANDBOX_API_KEY_NAME, type ApiKeyService } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:api-key:agent-sandbox");

/**
 * How long a sandbox key stays valid. Long enough to outlast a run, short enough that a leaked
 * key is worth little. A run that lasts longer sees its cache calls refused and every row does
 * its own work, which is what a run without the key does anyway.
 */
export const AGENT_SANDBOX_KEY_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * The whole surface a sandbox key reaches: the project's agent cache, and nothing else. Add a
 * grain here only when agent code in the sandbox has a reason to call the route that asks for
 * it. `agentCache:manage` alone, because it is what all three cache routes ask for.
 */
export const AGENT_SANDBOX_PERMISSIONS: readonly string[] = ["agentCache:manage"];

export class AgentSandboxKeyMintService {
  private constructor() {}

  static create(): AgentSandboxKeyMintService {
    return new AgentSandboxKeyMintService();
  }

  /**
   * Mint the credential a code agent's sandbox authenticates with. The key belongs to no user,
   * is bound to one project, and holds the agent cache grains only, so it is strictly narrower
   * than the project key that authorized the run.
   */
  static async mint({
    apiKeys,
    projectId,
    organizationId,
  }: {
    apiKeys: ApiKeyService;
    projectId: string;
    organizationId: string;
  }): Promise<string> {
    const { token } = await apiKeys.create({
      isSystemManaged: true,
      name: AGENT_SANDBOX_API_KEY_NAME,
      description:
        "Short-lived key for one code agent run. Reaches the project's agent " +
        "cache and nothing else, and expires by itself.",
      // No owner and no creator: there is no person behind a run's sandbox, and
      // a key with no owner has no user ceiling to clamp. The grains below are
      // the whole ceiling instead.
      userId: null,
      createdByUserId: null,
      organizationId,
      permissionMode: "restricted",
      permissions: [...AGENT_SANDBOX_PERMISSIONS],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
      expiresAt: new Date(Date.now() + AGENT_SANDBOX_KEY_TTL_MS),
    });

    return token;
  }

  /**
   * Mint a sandbox key, or report that the run goes without one. A run that cannot get a key
   * must still run: its rows each do their own work and the cache simply never answers. So a
   * failure here is a warning and an `undefined`, never a thrown error that would stop the run.
   */
  static async tryMint({
    apiKeys,
    projectId,
    organizationId,
  }: {
    apiKeys: ApiKeyService;
    projectId: string;
    organizationId: string;
  }): Promise<string | undefined> {
    try {
      return await AgentSandboxKeyMintService.mint({
        apiKeys,
        projectId,
        organizationId,
      });
    } catch (error) {
      logger.warn(
        { projectId, error },
        "could not mint an agent sandbox key; the run continues without the agent cache",
      );

      return undefined;
    }
  }
}
