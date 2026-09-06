/**
 * The credential a code agent's sandbox authenticates with.
 */
import { AGENT_SANDBOX_API_KEY_NAME, type ApiKeyService } from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";

import type { AgentSandboxKeySharePort } from "../ports/agent-sandbox-key-share.port";
import type { ApiKeyRepository } from "../repositories/api-key.repository";

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
  static create(options: {
    apiKeys: ApiKeyService;
    /** Resolves whose credential a personal workspace's key has to be. */
    repository: Pick<ApiKeyRepository, "tryFindPersonalWorkspaceOwner">;
    share: AgentSandboxKeySharePort;
  }): AgentSandboxKeyMintService {
    return new AgentSandboxKeyMintService(options.apiKeys, options.repository, options.share);
  }

  private constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly repository: Pick<ApiKeyRepository, "tryFindPersonalWorkspaceOwner">,
    private readonly share: AgentSandboxKeySharePort,
  ) {}

  /**
   * Mint the credential a code agent's sandbox authenticates with. The key is bound to one
   * project and holds the agent cache grains only, so it is strictly narrower than the project
   * key that authorized the run.
   */
  async mint({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string;
  }): Promise<string> {
    const ownerUserId = await this.ownerOf({ projectId, organizationId });
    const { token } = await this.apiKeys.create({
      isSystemManaged: true,
      name: AGENT_SANDBOX_API_KEY_NAME,
      description:
        "Short-lived key shared by the code agent runs of one project. Reaches the " +
        "project's agent cache and nothing else, and expires by itself.",
      // In a shared project there is no person behind a run's sandbox, and a key with no owner
      // has no user ceiling to clamp, so the grains below are the whole ceiling. A personal
      // workspace admits no principal but its owner, so there the key is the owner's own.
      userId: ownerUserId,
      createdByUserId: ownerUserId,
      organizationId,
      permissionMode: "restricted",
      permissions: [...AGENT_SANDBOX_PERMISSIONS],
      bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
      expiresAt: new Date(Date.now() + AGENT_SANDBOX_KEY_TTL_MS),
    });

    return token;
  }

  /**
   * The key a run of this project puts in its sandbox: the one the project's runs currently
   * share, or a freshly minted one when there is none. Two runs that start together on an empty
   * share may both mint; both keys are valid and the later one is shared from then on.
   */
  async getOrMint(input: { projectId: string; organizationId: string }): Promise<string> {
    const held = await this.share.tryGet({ projectId: input.projectId });
    if (held !== undefined) return held;

    const token = await this.mint(input);
    await this.share.hold({ projectId: input.projectId, token });
    return token;
  }

  /**
   * Get a sandbox key, or report that the run goes without one. A run that cannot get a key
   * must still run: its rows each do their own work and the cache simply never answers. So a
   * failure here is a warning and an `undefined`, never a thrown error that would stop the run.
   */
  async tryGetOrMint(input: {
    projectId: string;
    organizationId: string;
  }): Promise<string | undefined> {
    try {
      return await this.getOrMint(input);
    } catch (error) {
      logger.warn(
        { projectId: input.projectId, error },
        "could not get an agent sandbox key; the run continues without the agent cache",
      );

      return undefined;
    }
  }

  // A personal workspace admits no principal but its owner, so the grant policy
  // refuses an ownerless key there; the one it accepts is the owner's own, and
  // the owner's ceiling then caps it. No recorded owner answers null and the
  // mint is refused — the guard's own rule for incomplete provisioning.

  /**
   * Whose credential the sandbox key is: the workspace owner's in a personal
   * workspace, nobody's in a shared project.
   */
  private async ownerOf(input: {
    projectId: string;
    organizationId: string;
  }): Promise<string | null> {
    const personal = await this.repository.tryFindPersonalWorkspaceOwner({
      organizationId: input.organizationId,
      scopeId: input.projectId,
    });

    return personal?.ownerUserId ?? null;
  }
}
