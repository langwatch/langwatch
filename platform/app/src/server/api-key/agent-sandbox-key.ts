import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { decrypt, encrypt } from "~/utils/encryption";
import { TtlCache } from "../utils/ttlCache";
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
 * How long the runs of one project share a key before the next one is
 * minted. Shorter than the key's own lifetime by a margin no run outlasts,
 * so a run that picks up a shared key near the end of this window still
 * holds a key with hours to live.
 *
 * Sharing is what keeps the key ledger small: a project that runs all day
 * mints three keys, not one per run, and a project that runs nothing mints
 * none. The key stays short-lived either way, because the token is only
 * held for this window and never written to a durable store.
 */
export const AGENT_SANDBOX_KEY_REUSE_MS = 8 * 60 * 60 * 1000;

const AGENT_SANDBOX_KEY_CACHE_PREFIX = "ttlcache:agent-sandbox-key:";

/**
 * The token each project's runs currently share, encrypted at rest, keyed by
 * project id. The database holds only the token's hash, so this is the one
 * place the plaintext survives past the mint, and only for the reuse window.
 */
const sharedKeys = new TtlCache<string>(
  AGENT_SANDBOX_KEY_REUSE_MS,
  AGENT_SANDBOX_KEY_CACHE_PREFIX,
);

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
 * it is strictly narrower than the project key that authorized the run. In a
 * shared project it belongs to no user; in a personal workspace it belongs
 * to the workspace owner, see {@link sandboxKeyOwner}.
 *
 * Runs do not call this directly: {@link getOrMintAgentSandboxApiKey} hands
 * out the project's shared key and mints a new one here only when there is
 * none to share. The token is returned once and is unrecoverable from the
 * database afterwards; only its hash is stored there. Nothing logs it.
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
      "Short-lived key shared by the code agent runs of one project. Reaches " +
      "the project's agent cache and nothing else, and expires by itself.",
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
 * The key a run of this project puts in its sandbox: the one the project's
 * runs currently share, or a freshly minted one when there is none.
 *
 * Every run of a project holds the same authority over the same cache, so
 * one key serves them all. The shared token is held encrypted for
 * {@link AGENT_SANDBOX_KEY_REUSE_MS}; once that passes, or when the held
 * value cannot be read (the instance's encryption key changed, or the store
 * lost the entry), the next run mints a new key and shares it in turn. Two
 * runs that start together on an empty store may both mint; both keys are
 * valid and the later one is the one shared from then on.
 *
 * `cache` is for tests, which hand in their own store rather than sharing
 * the module's.
 */
export async function getOrMintAgentSandboxApiKey({
  prisma,
  projectId,
  organizationId,
  cache = sharedKeys,
}: {
  prisma: PrismaClient;
  projectId: string;
  organizationId: string;
  cache?: TtlCache<string>;
}): Promise<string> {
  const held = await cache.get(projectId);
  if (held !== undefined) {
    try {
      return decrypt(held);
    } catch {
      logger.warn(
        { projectId },
        "the shared agent sandbox key could not be read; minting a new one",
      );
    }
  }

  const token = await mintAgentSandboxApiKey({
    prisma,
    projectId,
    organizationId,
  });
  await cache.set(projectId, encrypt(token));
  return token;
}

/**
 * Get the sandbox key for a run, or report that the run goes without one.
 *
 * A run that cannot get a key must still run: its rows each do their own work
 * and the cache simply never answers. So a failure here is a warning and an
 * `undefined`, never a thrown error that would stop the run.
 */
export async function tryGetAgentSandboxApiKey({
  prisma,
  projectId,
  organizationId,
}: {
  prisma: PrismaClient;
  projectId: string;
  organizationId: string;
}): Promise<string | undefined> {
  try {
    return await getOrMintAgentSandboxApiKey({
      prisma,
      projectId,
      organizationId,
    });
  } catch (error) {
    logger.warn(
      { projectId, error },
      "could not get an agent sandbox key; the run continues without the agent cache",
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
