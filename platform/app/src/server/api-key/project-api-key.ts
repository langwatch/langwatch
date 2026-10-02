import crypto from "node:crypto";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient, Project } from "~/generated/prisma/client";
import { generateApiKey } from "../utils/apiKeyGenerator";
import { hashSecret } from "./api-key-token.utils";

const logger = createLogger("langwatch:api-key:project-api-key");

/**
 * How long a project API key keeps its plaintext after it was first hashed.
 *
 * The release that hashes keys still runs beside the previous one during a
 * rolling deploy, and the previous one authenticates by plaintext only. The
 * window also leaves room to roll back. After it, the plaintext is cleared and
 * the key is a hash like every other API key.
 */
export const PROJECT_API_KEY_PLAINTEXT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const TEAM_INCLUDE = {
  team: { select: { id: true, organizationId: true } },
} as const;

export type ProjectWithTeam = Project & {
  team: { id: string; organizationId: string };
};

/**
 * HMAC-SHA256 of a whole project API key, keyed by the same pepper as the
 * secrets of user API keys. Deterministic, so the hash is the lookup key.
 */
export function hashProjectApiKey(token: string): string {
  return hashSecret(token);
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * A new project API key and the columns that store it. The token is returned
 * once, to be shown to the person who created or rotated it; only its hash and
 * its last four characters are stored.
 */
export function mintProjectApiKey({
  token = generateApiKey(),
}: {
  token?: string;
} = {}): {
  token: string;
  columns: {
    apiKey: null;
    apiKeyHash: string;
    apiKeyLast4: string;
    apiKeyHashedAt: null;
  };
} {
  return {
    token,
    columns: {
      apiKey: null,
      apiKeyHash: hashProjectApiKey(token),
      apiKeyLast4: token.slice(-4),
      apiKeyHashedAt: null,
    },
  };
}

/**
 * Store the hash of a key that was found by its plaintext. Guarded on the
 * plaintext so a rotation that lands in between is never overwritten.
 */
async function recordHash({
  prisma,
  projectId,
  plaintext,
  now,
}: {
  prisma: PrismaClient;
  projectId: string;
  plaintext: string;
  now: Date;
}): Promise<boolean> {
  const { count } = await prisma.project.updateMany({
    where: { id: projectId, apiKey: plaintext },
    data: {
      apiKeyHash: hashProjectApiKey(plaintext),
      apiKeyLast4: plaintext.slice(-4),
      apiKeyHashedAt: now,
    },
  });
  return count > 0;
}

/**
 * The project a project API key, or a project's internal key, authenticates
 * as. Archived projects authenticate nothing.
 *
 * One indexed read in the common case: the key's hash. A key whose row still
 * holds only its plaintext (stored before keys were hashed and not yet reached
 * by the sweep, or written by a pod of the previous release during a deploy)
 * is found by plaintext and hashed on the spot.
 *
 * A pod of the previous release rotates a key by writing the new plaintext
 * only, which leaves the old key's hash on the row. So a hash hit on a row
 * that still holds plaintext counts only when that plaintext hashes to the
 * same value; otherwise the hash is stale, the row is re-hashed, and the old
 * key is refused.
 */
export async function findProjectByApiKey({
  prisma,
  token,
  now = new Date(),
}: {
  prisma: PrismaClient;
  token: string;
  now?: Date;
}): Promise<ProjectWithTeam | null> {
  if (!token) return null;
  const hash = hashProjectApiKey(token);

  const byHash = await prisma.project.findUnique({
    where: { apiKeyHash: hash },
    include: TEAM_INCLUDE,
  });
  if (byHash) {
    if (
      byHash.apiKey !== null &&
      !sameHash(hashProjectApiKey(byHash.apiKey), hash)
    ) {
      await recordHash({
        prisma,
        projectId: byHash.id,
        plaintext: byHash.apiKey,
        now,
      }).catch((error) =>
        logger.warn(
          { projectId: byHash.id, error },
          "could not re-hash a project API key rotated by the previous release",
        ),
      );
      return null;
    }
    return byHash.archivedAt === null ? byHash : null;
  }

  const internal = await prisma.projectInternalKey.findUnique({
    where: { tokenHash: hash },
    include: { project: { include: TEAM_INCLUDE } },
  });
  if (internal) {
    return internal.project.archivedAt === null ? internal.project : null;
  }

  const byPlaintext = await prisma.project.findUnique({
    where: { apiKey: token },
    include: TEAM_INCLUDE,
  });
  if (!byPlaintext) return null;

  await recordHash({
    prisma,
    projectId: byPlaintext.id,
    plaintext: token,
    now,
  }).catch((error) =>
    logger.warn(
      { projectId: byPlaintext.id, error },
      "could not hash a project API key found by its plaintext",
    ),
  );
  return byPlaintext.archivedAt === null ? byPlaintext : null;
}

export interface ProjectApiKeySweepResult {
  /** Rows whose hash was missing or stale and is now written. */
  hashed: number;
  /** Rows whose plaintext was cleared after the grace window. */
  cleared: number;
}

/**
 * Hash every project API key still stored in plaintext, and clear the
 * plaintext of keys hashed longer than `graceMs` ago.
 *
 * Idempotent and safe to run on several workers at once: every write is
 * guarded on the plaintext it read, so a concurrent rotation or a concurrent
 * sweep makes it a no-op. The hash is always recomputed from the plaintext,
 * so a hash left stale by a rotation on the previous release is corrected
 * here, and the plaintext is cleared only when the stored hash matches it.
 */
export async function sweepProjectApiKeys({
  prisma,
  now = new Date(),
  graceMs = PROJECT_API_KEY_PLAINTEXT_GRACE_MS,
  batchSize = 500,
}: {
  prisma: PrismaClient;
  now?: Date;
  graceMs?: number;
  batchSize?: number;
}): Promise<ProjectApiKeySweepResult> {
  const clearBefore = now.getTime() - graceMs;
  const result: ProjectApiKeySweepResult = { hashed: 0, cleared: 0 };
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.project.findMany({
      where: {
        apiKey: { not: null },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        apiKey: true,
        apiKeyHash: true,
        apiKeyHashedAt: true,
      },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;

    for (const row of rows) {
      const plaintext = row.apiKey;
      if (plaintext === null) continue;
      const hash = hashProjectApiKey(plaintext);

      if (
        row.apiKeyHash === null ||
        !sameHash(row.apiKeyHash, hash) ||
        row.apiKeyHashedAt === null
      ) {
        if (await recordHash({ prisma, projectId: row.id, plaintext, now })) {
          result.hashed++;
        }
        continue;
      }

      if (row.apiKeyHashedAt.getTime() <= clearBefore) {
        const { count } = await prisma.project.updateMany({
          where: { id: row.id, apiKey: plaintext, apiKeyHash: hash },
          data: { apiKey: null },
        });
        result.cleared += count;
      }
    }

    if (rows.length < batchSize) break;
  }

  if (result.hashed > 0 || result.cleared > 0) {
    logger.info(result, "swept project API keys");
  }
  return result;
}
