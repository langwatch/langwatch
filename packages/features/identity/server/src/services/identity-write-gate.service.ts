/**
 * re-tenanted).
 * The per-USER write fork (ADR-101 §2, the grants ledger's decision-4 shape
 * engine gate (ADR-110: finishing the migration IS the switch). `migrated`
 */
import { createLogger } from "@langwatch/observability";
import { perSubjectCachedFlag } from "./per-subject-cached-gate.service";
import { identityWriteGateReadFailuresTotal } from "../adapters/metrics.identity-ledger.adapter";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../rules/identity-migration-names.rules";
import type { IdentityWriteGateStatePort } from "../ports/identity-write-gate-state.port";

const logger = createLogger("langwatch:identity:write-gate");

export const IDENTITY_WRITE_GATE_TTL_MS = 60_000;

const gate = perSubjectCachedFlag({
  name: "identity-identifier-write-gate",
  ttlMs: IDENTITY_WRITE_GATE_TTL_MS,
  // The gate keys by USER, not organization — cardinality is the fleet's
  // active users, so the cap is sized well above the default.
  maxEntries: 50_000,
});

/**
 * The pre-rollout short-circuit.
 */
const anyoneGate = perSubjectCachedFlag({
  name: "identity-identifier-anyone-finalized",
  ttlMs: IDENTITY_WRITE_GATE_TTL_MS,
  maxEntries: 1,
});

export class IdentityWriteGateService {
  static create({ state }: { state: IdentityWriteGateStatePort }): IdentityWriteGateService {
    return new IdentityWriteGateService(state);
  }

  /**
   * Drop this user's cached answer, and the fleet-wide "has anyone finalized" The born-finalized
   * entrance is what needs this, and needs it explicitly.
   * one with it (ADR-116 §3).
   */
  static forget({ userId }: { userId: string }): void {
    gate.invalidate({ subject: userId });
    anyoneGate.invalidate({
      subject: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
    });
  }

  /** The caches, dropped — for tests that latch a user mid-suite. */
  static resetForTests(): void {
    gate.resetForTesting();
    anyoneGate.resetForTesting();
  }

  private constructor(private readonly state: IdentityWriteGateStatePort) {}

  /**
   * Whether ANY user has finalized, fleet-wide — the short-circuit above, on its own.
   * Public because the storage adapter asks it directly (ADR-116 §7): an
   */
  isAnyoneOnIdentityWrites(): Promise<boolean> {
    return anyoneGate.get({
      subject: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
      read: () => this.readAnyoneOnIdentityWrites(),
    });
  }

  /** Whether THIS user's domain-significant ceremonies emit identity events. */
  async isUserOnIdentityWrites({ userId }: { userId: string }): Promise<boolean> {
    if (!(await this.isAnyoneOnIdentityWrites())) {
      return false;
    }

    return gate.get({
      subject: userId,
      read: () => this.readUserOnIdentityWrites({ userId }),
    });
  }

  private async readUserOnIdentityWrites({ userId }: { userId: string }): Promise<boolean> {
    try {
      const record = await this.state.tryFindRecord({
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

  private async readAnyoneOnIdentityWrites(): Promise<boolean> {
    try {
      return await this.state.hasFinalizedTenant({
        migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
      });
    } catch (error) {
      // Fail safe in the SAME direction as the per-user read: unreadable means
      // closed. Counted on the same counter — from an operator's point of view
      // it is the same failure with the same consequence.
      logger.warn(
        { error, ttlMs: IDENTITY_WRITE_GATE_TTL_MS },
        "could not read whether any user has finalized the identifier backfill; the gate stays closed until the cache expires",
      );
      identityWriteGateReadFailuresTotal.inc();

      return false;
    }
  }
}
