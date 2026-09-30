import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { CliLoginKeyService, loginKeyExpiresAt } from "./cli-login-key.service";
import { CLI_LOGIN_KEY_NAME_PREFIX } from "./reserved-names";

const logger = createLogger("langwatch:api-key:cli-login-key-reaper");

/**
 * Revoke every CLI login key whose session ran out, and the ingest keys under
 * each.
 *
 * A session the CLI stops refreshing leaves Redis by TTL, which runs no code,
 * so this sweep is what retires its login key. `expiresAt` on the key is the
 * session's own window (see `loginKeyExpiresAt`), so a reaped key could not
 * authenticate any more; the sweep is about the ingest keys parented to it,
 * which carry no expiry of their own and kept exporting until now.
 *
 * Each key is revoked through `CliLoginKeyService`, one at a time, so the
 * cascade runs and every row keeps its own tenant scope: the only thing that
 * crosses organizations here is the read of which keys elapsed, admitted by
 * the tenancy guard on exactly this predicate. With `organizationId` the
 * sweep is one organization's, which is what a policy change runs.
 */
export async function reapExpiredCliLoginKeys({
  prisma,
  now = new Date(),
  organizationId,
  loginKeys = CliLoginKeyService.create(prisma),
}: {
  prisma: PrismaClient;
  now?: Date;
  organizationId?: string;
  loginKeys?: Pick<CliLoginKeyService, "revokeSessionKey">;
}): Promise<number> {
  const elapsed = await prisma.apiKey.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      name: { startsWith: CLI_LOGIN_KEY_NAME_PREFIX },
      revokedAt: null,
      expiresAt: { not: null, lte: now },
    },
    select: { id: true, userId: true, organizationId: true },
  });

  let count = 0;
  for (const key of elapsed) {
    if (!key.userId) continue;
    try {
      const { loginKeyRevoked } = await loginKeys.revokeSessionKey({
        apiKeyId: key.id,
        userId: key.userId,
        organizationId: key.organizationId,
        cause: "expired",
      });
      if (loginKeyRevoked) count += 1;
    } catch (error) {
      logger.warn(
        { error, apiKeyId: key.id, organizationId: key.organizationId },
        "could not revoke an expired CLI login key",
      );
    }
  }
  if (count > 0) {
    logger.info({ count, organizationId }, "reaped expired CLI login keys");
  }
  return count;
}

/**
 * Re-derive the expiry of one organization's live login keys from a new max
 * session duration, then reap what elapsed. Runs when an admin changes the
 * policy, so a session already past the new ceiling is retired now rather
 * than at its next refresh. A ceiling of zero leaves the refresh windows as
 * they are: the next refresh recomputes them from the policy anyway.
 */
export async function applySessionCeiling({
  prisma,
  organizationId,
  maxSessionDurationDays,
  now = new Date(),
  loginKeys,
}: {
  prisma: PrismaClient;
  organizationId: string;
  maxSessionDurationDays: number;
  now?: Date;
  loginKeys?: Pick<CliLoginKeyService, "revokeSessionKey">;
}): Promise<number> {
  if (maxSessionDurationDays > 0) {
    const live = await prisma.apiKey.findMany({
      where: {
        organizationId,
        name: { startsWith: CLI_LOGIN_KEY_NAME_PREFIX },
        revokedAt: null,
        expiresAt: { not: null },
      },
      select: { id: true, createdAt: true, expiresAt: true },
    });
    for (const key of live) {
      if (!key.expiresAt) continue;
      // The key's creation is the session start; the refresh window it holds
      // is the current expiry, so the ceiling only ever brings it forward.
      const ceiling = loginKeyExpiresAt({
        nowMs: key.expiresAt.getTime(),
        sessionStartedAtMs: key.createdAt.getTime(),
        maxSessionDurationDays,
        refreshWindowMs: 0,
      });
      if (ceiling.getTime() < key.expiresAt.getTime()) {
        await prisma.apiKey.updateMany({
          where: { id: key.id, organizationId, revokedAt: null },
          data: { expiresAt: ceiling },
        });
      }
    }
  }
  return await reapExpiredCliLoginKeys({
    prisma,
    now,
    organizationId,
    ...(loginKeys ? { loginKeys } : {}),
  });
}
