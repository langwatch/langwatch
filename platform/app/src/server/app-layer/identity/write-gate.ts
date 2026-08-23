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
 *
 * The state repository is the caller's (the runtime composes it): this
 * module reads no Prisma of its own, the way the engine gate takes its
 * client from the caller.
 */
import { createLogger } from "@langwatch/observability";
import type { SystemMigrationStateRepository } from "@langwatch/system-migrations";
import { perSubjectCachedFlag } from "../_shared/per-subject-cached-gate";
import { identityWriteGateReadFailuresTotal } from "./metrics";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "./migration-name";

const logger = createLogger("langwatch:identity:write-gate");

export const IDENTITY_WRITE_GATE_TTL_MS = 60_000;

const gate = perSubjectCachedFlag({
  name: "identity-identifier-write-gate",
  ttlMs: IDENTITY_WRITE_GATE_TTL_MS,
  // The gate keys by USER, not organization — cardinality is the fleet's
  // active users, so the cap is sized well above the default.
  maxEntries: 50_000,
});

async function readUserOnIdentityWrites({
  userId,
  state,
}: {
  userId: string;
  state: SystemMigrationStateRepository;
}): Promise<boolean> {
  try {
    const record = await state.findRecord({
      migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
      tenantId: userId,
    });
    // Only `finalized` opens the gate; `migrated` is held (see above). The
    // D03 READ fork will ask the same question of the same row.
    return record?.status === "finalized";
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
  state,
}: {
  userId: string;
  state: SystemMigrationStateRepository;
}): Promise<boolean> {
  return gate.get({
    subject: userId,
    read: () => readUserOnIdentityWrites({ userId, state }),
  });
}

/** The cache, dropped — for tests that latch a user mid-suite. */
export function resetIdentityWriteGateForTests(): void {
  gate.resetForTesting();
}
