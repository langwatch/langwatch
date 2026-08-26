import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { ApiKeyService } from "./api-key.service";
import { AGENT_SANDBOX_API_KEY_NAME } from "./reserved-names";

const logger = createLogger("langwatch:api-key:agent-sandbox");

/**
 * How long a sandbox key stays valid. Long enough to outlast a run, short
 * enough that a leaked key is worth little. A run that lasts longer sees its
 * cache calls refused and every row does its own work, which is what a run
 * without the key does anyway.
 */
export const AGENT_SANDBOX_KEY_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * The whole surface a sandbox key reaches: the project's agent cache, and
 * nothing else. Add a grain here only when agent code in the sandbox has a
 * reason to call the route that asks for it.
 *
 * `agentCache:manage` alone, because it is what all three cache routes ask
 * for. Granting `agentCache:view` as well would reach no route today, and
 * would silently hand every sandbox in the product whatever a later
 * view-guarded route decides to answer.
 */
export const AGENT_SANDBOX_PERMISSIONS: readonly string[] = [
  "agentCache:manage",
];

/**
 * Mint the credential a code agent's sandbox authenticates with.
 *
 * The key belongs to no user, is bound to one project, and holds the agent
 * cache grains only, so it is strictly narrower than the project key that
 * authorized the run. The run mints one and every row of that run shares it.
 *
 * The token is returned once and is unrecoverable afterwards; only its hash is
 * stored. Nothing logs it.
 */
export async function mintAgentSandboxApiKey({
  prisma,
  projectId,
  organizationId,
}: {
  prisma: PrismaClient;
  projectId: string;
  organizationId: string;
}): Promise<string> {
  const service = ApiKeyService.create(prisma);
  const { token } = await service.create({
    isSystemManaged: true,
    name: AGENT_SANDBOX_API_KEY_NAME,
    description:
      "Short-lived key for one code agent run. Reaches the project's agent " +
      "cache and nothing else, and expires by itself.",
    // No owner: there is no person behind a run's sandbox, and a key with no
    // owner has no user ceiling to clamp. The grains below are the whole
    // ceiling instead.
    userId: null,
    organizationId,
    permissionMode: "restricted",
    permissions: [...AGENT_SANDBOX_PERMISSIONS],
    bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
    expiresAt: new Date(Date.now() + AGENT_SANDBOX_KEY_TTL_MS),
  });

  return token;
}

/**
 * Mint a sandbox key, or report that the run goes without one.
 *
 * A run that cannot get a key must still run: its rows each do their own work
 * and the cache simply never answers. So a failure here is a warning and an
 * `undefined`, never a thrown error that would stop the run.
 */
export async function tryMintAgentSandboxApiKey({
  prisma,
  projectId,
  organizationId,
}: {
  prisma: PrismaClient;
  projectId: string;
  organizationId: string;
}): Promise<string | undefined> {
  try {
    return await mintAgentSandboxApiKey({
      prisma,
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

/**
 * Revoke every sandbox key whose lifetime has elapsed.
 *
 * The mint has no counterpart at the end of a run, so this is the only thing
 * that retires a key. Gated on the reserved name, so it can never touch a key
 * a customer created.
 */
export async function reapExpiredAgentSandboxApiKeys({
  prisma,
  now = new Date(),
}: {
  prisma: PrismaClient;
  now?: Date;
}): Promise<number> {
  const { count } = await prisma.apiKey.updateMany({
    where: {
      name: AGENT_SANDBOX_API_KEY_NAME,
      revokedAt: null,
      expiresAt: { not: null, lte: now },
    },
    data: { revokedAt: now },
  });
  if (count > 0) {
    logger.info({ count }, "reaped expired agent sandbox keys");
  }
  return count;
}
