/**
 * The per-USER write fork (ADR-101 §2, the grants ledger's decision-4 shape
 * re-tenanted). The gate ships CLOSED: in every pod, for every user, until
 * that user's identifier backfill lands — deploying the identity adapter
 * changes nothing on its own.
 *
 * The gate's question is the one fact that already means "this user's whole
 * identifier history is in the log": their `SystemMigrationTenantState` row
 * for the D01 backfill (tenant = the user, driven by the runner's user-rooted
 * tenant source). Only `finalized` opens it — the same predicate as the authz
 * engine gate (ADR-110: finishing the migration IS the switch). `migrated`
 * is the HELD state: the history landed but the proof found the projection
 * behind or disagreeing, so the ceremony performs its protocol write only,
 * exactly as the stock adapter would, and the next backfill pass restates
 * the rows it wrote. Anything else (absent, parked, rolled back) is closed.
 *
 * Rollback is an ops action, not a deploy: `rolled_back` on the user's row
 * closes the gate fleet-wide within the cache TTL — there is no
 * cross-pod invalidation, so both directions take effect within
 * `IDENTITY_WRITE_GATE_TTL_MS`, which is the bound an operator should expect.
 * Fail-safe direction is CLOSED — an unreadable state table can only delay
 * event history, never break sign-in.
 */
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { prisma as appPrisma } from "../../db";
import { perSubjectCachedFlag } from "../_shared/per-subject-cached-gate";
import { identityWriteGateReadFailuresTotal } from "./metrics";

const logger = createLogger("langwatch:identity:identifier-write-gate");

/** The D01 backfill's name. The gate keys on its state rows, so the flip is
 *  data, not a deploy. Renaming orphans every stored record — the standard
 *  migration-name rule. */
export const IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME =
  "identity-d01-identifier-backfill" as const;

/** Only `finalized` opens the gate; `migrated` is held (see above). The D03
 *  READ fork will ask the same question of the same row. */
const IDENTITY_WRITE_STATUSES = ["finalized"] as const;

export const IDENTITY_WRITE_GATE_TTL_MS = 60_000;

const gate = perSubjectCachedFlag({
  name: "identity-identifier-write-gate",
  ttlMs: IDENTITY_WRITE_GATE_TTL_MS,
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
