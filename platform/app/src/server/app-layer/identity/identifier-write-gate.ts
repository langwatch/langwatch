/**
 * The per-USER write fork (ADR-101 §2, the grants ledger's decision-4 shape
 * re-tenanted). The gate ships CLOSED: in every pod, for every user, until
 * that user's identifier backfill lands — deploying the identity adapter
 * changes nothing on its own.
 *
 * The gate's question is the one fact that already means "this user's whole
 * identifier history is in the log": their `SystemMigrationTenantState` row
 * for the D01 backfill (tenant = the user; the runner gains a user-rooted
 * tenant source in PR 2). `migrated` or `finalized` means live ceremonies
 * may emit events without preceding their own history; anything else means
 * the ceremony performs its protocol write only, exactly as the stock
 * adapter would, and the next backfill pass adopts the rows it wrote.
 *
 * Rollback is an ops action, not a deploy: `rolled_back` on the user's row
 * closes the gate fleet-wide within the cache TTL. Fail-safe direction is
 * CLOSED — an unreadable state table can only delay event history, never
 * break sign-in.
 */
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { prisma as appPrisma } from "../../db";
import { perSubjectCachedFlag } from "../_shared/per-subject-cached-gate";
import { identityWriteGateReadFailuresTotal } from "./metrics";

const logger = createLogger("langwatch:identity:identifier-write-gate");

/** The D01 backfill rider's name (PR 2 registers the migration itself; the
 *  gate keys on its state rows from PR 1 so the flip is data, not a deploy).
 *  Renaming orphans every stored record — the standard migration-name rule. */
export const IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME =
  "identity-d01-identifier-backfill" as const;

/** `migrated` is enough for the WRITE side: the history is in and the
 *  projection is fed. Finalization (the self-proving parity latch) gates
 *  the D03 READ fork, a later and separate question. */
const IDENTITY_WRITE_STATUSES = ["migrated", "finalized"] as const;

export const IDENTITY_WRITE_GATE_TTL_MS = 60_000;

const gate = perSubjectCachedFlag({
  name: "identity-identifier-write-gate",
  positiveTtlMs: IDENTITY_WRITE_GATE_TTL_MS,
  negativeTtlMs: IDENTITY_WRITE_GATE_TTL_MS,
});

async function readUserOnIdentityWrites({
  userId,
  prisma,
}: {
  userId: string;
  prisma: Pick<PrismaClient, "systemMigrationTenantState">;
}): Promise<boolean> {
  try {
    const record = await prisma.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
          tenantId: userId,
        },
      },
      select: { status: true },
    });
    return (
      record !== null &&
      (IDENTITY_WRITE_STATUSES as readonly string[]).includes(record.status)
    );
  } catch (error) {
    // Fail safe: an unreadable state table keeps the user's ceremonies on
    // the protocol-only path, which always works; the missing events are
    // adopted by the backfill's next pass. Logged and counted because the
    // failure is otherwise perfectly silent.
    logger.warn(
      { userId, error, ttlMs: IDENTITY_WRITE_GATE_TTL_MS },
      "could not read the identifier-backfill state; this user's ceremonies emit no events until the cache expires",
    );
    identityWriteGateReadFailuresTotal.inc();
    return false;
  }
}

/** Whether THIS user's domain-significant ceremonies emit identity events. */
export async function isUserOnIdentityWrites({
  userId,
  prisma = appPrisma,
}: {
  userId: string;
  prisma?: Pick<PrismaClient, "systemMigrationTenantState">;
}): Promise<boolean> {
  return gate.get({
    subject: userId,
    read: () => readUserOnIdentityWrites({ userId, prisma }),
  });
}

/** Drop one user's cached answer — the backfill calls this as it latches. */
export function invalidateIdentityWriteGate({
  userId,
}: {
  userId: string;
}): void {
  gate.invalidate({ subject: userId });
}

/** The cache, dropped — for tests that latch a user mid-suite. */
export function resetIdentityWriteGateForTests(): void {
  gate.resetForTesting();
}
