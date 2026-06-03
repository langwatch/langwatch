import type { PrismaClient } from "@prisma/client";
import { Prisma, RoleBindingScopeType } from "@prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import {
  computePermissionsFromSelections,
  type AccessLevel,
} from "~/server/api-key/permission-categories";
import { encrypt, decrypt } from "~/utils/encryption";
import { createLogger } from "~/utils/logger/server";

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

async function hasLangyKey(
  prisma: PrismaClient,
  projectId: string,
): Promise<boolean> {
  const existing = await prisma.apiKey.findFirst({
    where: {
      name: LANGY_API_KEY_NAME,
      revokedAt: null,
      roleBindings: {
        some: {
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: projectId,
        },
      },
    },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Returns the decrypted, ready-to-use dedicated Langy key token for a project,
 * or null if it hasn't been provisioned yet. This is the token the worker's MCP
 * server uses as LANGWATCH_API_KEY.
 */
export async function getLangyApiKeyToken(
  prisma: PrismaClient,
  projectId: string,
): Promise<string | null> {
  const secret = await prisma.projectSecret.findUnique({
    where: {
      projectId_name: { projectId, name: LANGY_API_KEY_SECRET_NAME },
    },
    select: { encryptedValue: true },
  });
  return secret ? decrypt(secret.encryptedValue) : null;
}

/**
 * ProjectSecret.createdById is non-null, so the stored token must be attributed
 * to a user: the explicit actor when we have one (project creation / runtime),
 * else the organization's first admin (the backfill path, which has no actor).
 */
async function resolveCreatorId(
  prisma: PrismaClient,
  organizationId: string,
  createdByUserId: string | null,
): Promise<string | null> {
  if (createdByUserId) return createdByUserId;
  const admin = await prisma.organizationUser.findFirst({
    where: { organizationId, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return admin?.userId ?? null;
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
  if (await getLangyApiKeyToken(prisma, projectId)) return;

  const creatorId = await resolveCreatorId(
    prisma,
    organizationId,
    createdByUserId,
  );
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
): Promise<{ provisioned: number; skipped: number; failed: number }> {
  // Only real user workspaces. Hidden "internal_governance" routing projects
  // are not user-facing and must never receive a Langy key.
  const projects = await prisma.project.findMany({
    where: { kind: "application" },
    select: { id: true, team: { select: { organizationId: true } } },
  });

  let provisioned = 0;
  let skipped = 0;
  let failed = 0;

  for (const project of projects) {
    if (await getLangyApiKeyToken(prisma, project.id)) {
      skipped++;
      continue;
    }
    if (dryRun) {
      provisioned++; // would-provision count
      continue;
    }
    try {
      await provisionLangyApiKey({
        prisma,
        projectId: project.id,
        organizationId: project.team.organizationId,
      });
      provisioned++;
    } catch (err) {
      failed++;
      logger.error(
        { err, projectId: project.id },
        "failed to backfill Langy key for project",
      );
    }
  }

  logger.info(
    { provisioned, skipped, failed, dryRun },
    "Langy key backfill complete",
  );
  return { provisioned, skipped, failed };
}
