import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import {
  computePermissionsFromSelections,
  type AccessLevel,
} from "~/server/api-key/permission-categories";
import { encrypt, decrypt } from "~/utils/encryption";
import { createLogger } from "~/utils/logger/server";
import { resolveAttributionUserId } from "./langyAttribution";
import { backfillLangyCredentialPerProject } from "./langyBackfill";

const logger = createLogger("langwatch:langy:api-key");

export const LANGY_API_KEY_NAME = "Langy";

// ProjectSecret name under which the dedicated Langy key's one-time token is
// stored (encrypted). The ApiKey row only keeps a hash of the secret, so the
// usable token MUST be captured at mint time for the runtime (the worker's MCP
// server) to retrieve it later — same pattern as the Langy virtual key.
export const LANGY_API_KEY_SECRET_NAME = "langy_api_key_secret";

// Least-privilege surface for the Langy assistant, expressed in the same
// permission categories the API-key UI uses so it stays valid and auditable.
// Deliberately omits secrets, project/team management, and the audit log — a
// leaked Langy key must not be able to administer the project or read secrets.
const LANGY_PERMISSION_SELECTIONS: Record<string, AccessLevel | "none"> = {
  traces: "write",
  evaluations: "write",
  datasets: "write",
  scenarios: "write",
  annotations: "write",
  analytics: "write",
  prompts: "write",
  triggers: "write",
  workflows: "write",
  cost: "read",
};

const LANGY_PERMISSIONS = computePermissionsFromSelections(
  LANGY_PERMISSION_SELECTIONS,
);

/**
 * Returns the decrypted, ready-to-use dedicated Langy key token for a project,
 * or null if it hasn't been provisioned yet. This is the token the worker's MCP
 * server uses as LANGWATCH_API_KEY.
 */
export async function getLangyApiKeyToken({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<string | null> {
  // findFirst with an explicit `projectId` (NOT findUnique-by-`projectId_name`):
  // the request-scoped prisma client runs a multitenancy guard that recognizes a
  // plain `projectId` predicate but NOT the `projectId_name` compound key, and
  // would otherwise throw "requires a 'projectId' in the where clause". This is
  // why the creation-hook mint silently failed under ctx.prisma. ProjectSecret is
  // unique on (projectId, name), so this still returns exactly the one row.
  const secret = await prisma.projectSecret.findFirst({
    where: { projectId, name: LANGY_API_KEY_SECRET_NAME },
    select: { encryptedValue: true },
  });
  return secret ? decrypt(secret.encryptedValue) : null;
}

/**
 * Mints the dedicated Langy key for a project — a service key (no human owner),
 * named "Langy", restricted to a least-privilege permission set, bound to the
 * project scope only — AND stores its one-time token (encrypted) so the runtime
 * can hand it to the worker.
 *
 * Idempotent: a no-op once the usable token is stored. The "provisioned" gate is
 * the stored token (not just the ApiKey row), because a key whose token wasn't
 * captured is useless to the worker.
 */
export async function provisionLangyApiKey({
  prisma,
  projectId,
  organizationId,
  createdByUserId = null,
}: {
  prisma: PrismaClient;
  projectId: string;
  organizationId: string;
  createdByUserId?: string | null;
}): Promise<void> {
  if (await getLangyApiKeyToken({ prisma, projectId })) return;

  const creatorId = await resolveAttributionUserId({
    prisma,
    organizationId,
    explicitUserId: createdByUserId,
  });
  if (!creatorId) {
    logger.warn(
      { projectId },
      "no user to attribute the Langy key token to; skipping — the runtime falls back to the project ingestion key",
    );
    return;
  }

  const service = ApiKeyService.create(prisma);
  const { token } = await service.create({
    name: LANGY_API_KEY_NAME,
    description:
      "Dedicated key for the Langy in-product assistant. Scoped to this project; revoke to cut off Langy's access.",
    userId: null, // service key — owned by no individual user
    createdByUserId: creatorId,
    organizationId,
    permissionMode: "restricted",
    permissions: LANGY_PERMISSIONS,
    bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: projectId }],
  });

  try {
    await prisma.projectSecret.create({
      data: {
        projectId,
        name: LANGY_API_KEY_SECRET_NAME,
        encryptedValue: encrypt(token),
        createdById: creatorId,
        updatedById: creatorId,
      },
    });
  } catch (error) {
    // Race: another provision stored the token first. The key we just minted is
    // an orphan (harmless, revocable later); the winner's stored token is the
    // authoritative one. Acceptable for v1.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}

/**
 * Reconciles existing projects: provisions the Langy key + token for every
 * project that lacks one. Idempotent — safe to run repeatedly. Per-project
 * failures are logged and skipped so one bad project never aborts the sweep.
 */
export async function backfillLangyApiKeys(
  prisma: PrismaClient,
  { dryRun = false }: { dryRun?: boolean } = {},
) {
  return await backfillLangyCredentialPerProject({
    prisma,
    dryRun,
    label: "Langy key",
    logger,
    isProvisioned: async (project) =>
      Boolean(await getLangyApiKeyToken({ prisma, projectId: project.id })),
    provision: async (project) => {
      await provisionLangyApiKey({
        prisma,
        projectId: project.id,
        organizationId: project.organizationId,
      });
      return "provisioned";
    },
  });
}
