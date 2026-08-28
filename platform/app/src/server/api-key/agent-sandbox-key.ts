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
 * Whose credential the sandbox key is: the workspace owner's in a personal
 * workspace, nobody's in a shared project.
 *
 * A personal workspace admits no principal but its owner, and a key owned by
 * nobody is a second principal, so `ApiKeyService.create` refuses it there
 * (`assertPersonalTeamScopesOwnedBy`). The one credential such a workspace
 * accepts is its owner's own, which is the owner acting programmatically, the
 * same way the Langy session key is minted. The owner's ceiling then caps the
 * key, and the owner administers their own workspace, so the manage grain is
 * inside it.
 *
 * A personal workspace with no recorded owner answers null, and the mint is
 * refused the same way it would be for a stranger: failing closed is the
 * guard's own rule for incomplete provisioning.
 */
async function sandboxKeyOwner({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      isPersonal: true,
      ownerUserId: true,
      team: { select: { isPersonal: true, ownerUserId: true } },
    },
  });
  if (!project) return null;
  if (project.isPersonal || project.team.isPersonal) {
    return project.ownerUserId ?? project.team.ownerUserId ?? null;
  }
  return null;
}

/**
 * Mint the credential a code agent's sandbox authenticates with.
 *
 * The key is bound to one project and holds the agent cache grains only, so
 * it is strictly narrower than the project key that authorized the run. The
 * run mints one and every row of that run shares it. In a shared project it
 * belongs to no user; in a personal workspace it belongs to the workspace
 * owner, see {@link sandboxKeyOwner}.
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
  const ownerUserId = await sandboxKeyOwner({ prisma, projectId });
  const service = ApiKeyService.create(prisma);
  const { token } = await service.create({
    isSystemManaged: true,
    name: AGENT_SANDBOX_API_KEY_NAME,
    description:
      "Short-lived key for one code agent run. Reaches the project's agent " +
      "cache and nothing else, and expires by itself.",
    // In a shared project there is no person behind a run's sandbox, and a
    // key with no owner has no user ceiling to clamp, so the grains below are
    // the whole ceiling. A personal workspace takes only its owner's own key.
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
