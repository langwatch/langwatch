import { describe, expect, it, vi } from "vitest";
import {
  IdentityIdentifierNotFoundError,
  IdentityIdentifierNotVerifiableError,
  IdentityPrimaryMustDemoteFirstError,
} from "~/server/event-sourcing/pipelines/identity/commands/identityCommandErrors";
import {
  arrivalStateForProvider,
  deriveIdentifierId,
  normalizeIdentifierValue,
} from "~/server/event-sourcing/pipelines/identity/projections/identifierIdentity";
import type {
  AttachIdentifierCommandData,
  DetachIdentifierCommandData,
  VerifyIdentifierCommandData,
} from "~/server/event-sourcing/pipelines/identity/schemas/commands";
import {
  type BackfillAccountRow,
  type BackfillIdentifierRow,
  type BackfillUserRow,
  type IdentifierBackfillMigrationDeps,
  IdentityIdentifierBackfillMigration,
} from "../migration/identifier-backfill.migration";

const USER = "user_sam";
const USER_CREATED_AT = Date.UTC(2023, 2, 14, 9, 30);
const ACCOUNT_CREATED_AT = Date.UTC(2023, 2, 14, 9, 31);

function samUser(overrides?: Partial<BackfillUserRow>): BackfillUserRow {
  return {
    id: USER,
    email: "Sam.J@Acme.com",
    emailVerified: true,
    createdAtMs: USER_CREATED_AT,
    userHashKey: "a-hash-key",
    ...overrides,
  };
}

function googleAccount(): BackfillAccountRow {
  return {
    id: "acc_google",
    provider: "google",
    providerAccountId: "google-sub-123",
    createdAtMs: ACCOUNT_CREATED_AT,
  };
}

/**
 * The harness's ceremonies mirror the real calling-path dispatch faithfully
 * where it matters to this migration: attach folds an Identifier row with
 * the same deterministic id derivation and arrival state, verify promotes
 * ATTACHED and refuses the states the real guard refuses — so the
 * migration's parity proof runs against rows shaped exactly like the fold's.
 */
function harness(options?: {
  user?: BackfillUserRow | null;
  accounts?: BackfillAccountRow[];
  applyCeremonies?: boolean;
  presetRows?: BackfillIdentifierRow[];
}) {
  const user = options?.user === undefined ? samUser() : options.user;
  const accounts = options?.accounts ?? [googleAccount()];
  const apply = options?.applyCeremonies ?? true;
  const rows = new Map<string, BackfillIdentifierRow>(
    (options?.presetRows ?? []).map((row) => [row.id, row]),
  );
  const minted: string[] = [];

  const attachIdentifier = vi.fn(async (data: AttachIdentifierCommandData) => {
    if (!apply) return [];
    const normalizedValue = normalizeIdentifierValue(data.value);
    const id = deriveIdentifierId({
      userId: data.userId,
      provider: data.provider,
      providerAccountId: data.providerAccountId,
      normalizedValue,
      occurredAtMs: data.occurredAtMs,
    });
    if (!rows.has(id)) {
      rows.set(id, {
        id,
        provider: data.provider,
        value: normalizedValue,
        accountId: data.accountId,
        state: arrivalStateForProvider(data.provider),
      });
    }
    return [];
  });

  const verifyIdentifier = vi.fn(async (data: VerifyIdentifierCommandData) => {
    const row = rows.get(data.identifierId);
    if (!row) {
      throw new IdentityIdentifierNotFoundError("no such identifier");
    }
    if (row.state === "VERIFIED" || row.state === "PRIMARY") return [];
    if (row.state !== "ATTACHED") {
      throw new IdentityIdentifierNotVerifiableError(
        `identifier is ${row.state}`,
      );
    }
    row.state = "VERIFIED";
    return [];
  });

  const detachIdentifier = vi.fn(async (data: DetachIdentifierCommandData) => {
    const row = rows.get(data.identifierId);
    if (!row) {
      throw new IdentityIdentifierNotFoundError("no such identifier");
    }
    if (row.state === "PRIMARY") {
      throw new IdentityPrimaryMustDemoteFirstError(
        "primary identifiers never detach directly",
      );
    }
    row.state = "DETACHED";
    return [];
  });

  const migration = new IdentityIdentifierBackfillMigration({
    reads: {
      findUser: async () => user,
      mintUserHashKeyIfMissing: async ({ userId }) => {
        minted.push(userId);
      },
      findAccountRows: async () => accounts,
      findIdentifierRows: async () => [...rows.values()],
    },
    ceremonies: {
      attachIdentifier,
      verifyIdentifier,
      detachIdentifier,
    } satisfies IdentifierBackfillMigrationDeps["ceremonies"],
    now: () => 1_800_000_000_000,
  });

  return {
    migration,
    rows,
    minted,
    attachIdentifier,
    verifyIdentifier,
    detachIdentifier,
  };
}

describe("the identifier backfill migration", () => {
  describe("when a user with legacy Account rows and a verified email migrates", () => {
    /** @scenario "The backfill adopts existing accounts and proves itself per user" */
    it("adopts with each source row's own business time and finalizes only on parity", async () => {
      const { migration, attachIdentifier } = harness();

      const outcome = await migration.migrateTenant({ tenantId: USER });

      expect(outcome.status).toBe("finalized");
      expect(outcome.report).toMatchObject({ kind: "adopted", identifiers: 2 });
      // Adoption events carry the source rows' own business time and
      // deterministic command ids — a re-run appends the same events.
      const calls = attachIdentifier.mock.calls.map(([data]) => data);
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            commandId: `backfill:user-email:${USER}`,
            occurredAtMs: USER_CREATED_AT,
            provider: "email",
          }),
          expect.objectContaining({
            commandId: "backfill:acc_google",
            occurredAtMs: ACCOUNT_CREATED_AT,
            provider: "google",
            accountId: "acc_google",
            providerAccountId: "google-sub-123",
          }),
        ]),
      );
    });

    it("is idempotent: a second pass re-derives the same command ids and stays finalized", async () => {
      const { migration, attachIdentifier } = harness();
      await migration.migrateTenant({ tenantId: USER });
      const firstIds = attachIdentifier.mock.calls.map(
        ([data]) => data.commandId,
      );
      const outcome = await migration.migrateTenant({ tenantId: USER });
      expect(outcome.status).toBe("finalized");
      const secondIds = attachIdentifier.mock.calls
        .slice(firstIds.length)
        .map(([data]) => data.commandId);
      expect(secondIds).toEqual(firstIds);
    });
  });

  describe("when an adopted Account row is gone on a later pass", () => {
    /** @scenario "The backfill detaches identifiers whose account row is gone" */
    it("detaches the orphaned identifier with a stable command id and finalizes", async () => {
      const first = harness();
      await first.migration.migrateTenant({ tenantId: USER });
      const googleRow = [...first.rows.values()].find(
        (row) => row.provider === "google",
      );
      expect(googleRow?.state).toBe("VERIFIED");

      const second = harness({
        accounts: [],
        presetRows: [...first.rows.values()],
      });
      const outcome = await second.migration.migrateTenant({ tenantId: USER });

      expect(outcome.status).toBe("finalized");
      expect(second.detachIdentifier).toHaveBeenCalledTimes(1);
      expect(second.detachIdentifier.mock.calls[0]?.[0]).toMatchObject({
        identifierId: googleRow?.id,
        commandId: `backfill:detach:${googleRow?.id}:${googleRow?.accountId}`,
        actor: { type: "system", id: "system:identity-backfill" },
      });
      expect(second.rows.get(googleRow?.id ?? "")?.state).toBe("DETACHED");
      // The email identifier has no account row and is never the backfill's
      // to detach.
      const emailRow = [...second.rows.values()].find(
        (row) => row.provider === "email",
      );
      expect(emailRow?.state).not.toBe("DETACHED");
    });

    it("never detaches twice: an already-detached identifier is left alone", async () => {
      const first = harness();
      await first.migration.migrateTenant({ tenantId: USER });
      const second = harness({
        accounts: [],
        presetRows: [...first.rows.values()],
      });
      await second.migration.migrateTenant({ tenantId: USER });
      const third = harness({
        accounts: [],
        presetRows: [...second.rows.values()],
      });

      await third.migration.migrateTenant({ tenantId: USER });

      expect(third.detachIdentifier).not.toHaveBeenCalled();
    });
  });

  describe("when the fold-built rows disagree with what the live rows imply", () => {
    it("holds the user at migrated with a diff report, never finalizes", async () => {
      const { migration } = harness({ applyCeremonies: false });

      const outcome = await migration.migrateTenant({ tenantId: USER });

      expect(outcome.status).toBe("migrated");
      expect(outcome.report).toMatchObject({ kind: "parity" });
      const diffs = (outcome.report as { diffs: Array<{ kind: string }> })
        .diffs;
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs[0]?.kind).toBe("identifier_missing");
    });

    it("a dead-ended email identifier holds the user instead of parking them", async () => {
      const normalizedValue = normalizeIdentifierValue("Sam.J@Acme.com");
      const emailId = deriveIdentifierId({
        userId: USER,
        provider: "email",
        providerAccountId: null,
        normalizedValue,
        occurredAtMs: USER_CREATED_AT,
      });
      const { migration } = harness({
        accounts: [],
        presetRows: [
          {
            id: emailId,
            provider: "email",
            value: normalizedValue,
            accountId: null,
            state: "DEAD_END",
          },
        ],
      });

      const outcome = await migration.migrateTenant({ tenantId: USER });

      expect(outcome.status).toBe("migrated");
      expect(outcome.report).toMatchObject({ kind: "parity" });
    });
  });

  describe("when the projection carries a live row nothing implies", () => {
    const staleId = deriveIdentifierId({
      userId: USER,
      provider: "email",
      providerAccountId: null,
      normalizedValue: normalizeIdentifierValue("old.address@acme.com"),
      occurredAtMs: USER_CREATED_AT,
    });

    it("holds the user with a surplus_row diff for a stale VERIFIED identifier", async () => {
      // The reachable case: the user changed their email, so the old value's
      // identifier is not in `expected` (the id derives from the value), has
      // no account row to orphan-detach, and would otherwise finalize while
      // still blocking the old address for every other user.
      const { migration } = harness({
        presetRows: [
          {
            id: staleId,
            provider: "email",
            value: normalizeIdentifierValue("old.address@acme.com"),
            accountId: null,
            state: "VERIFIED",
          },
        ],
      });

      const outcome = await migration.migrateTenant({ tenantId: USER });

      expect(outcome.status).toBe("migrated");
      expect(outcome.report).toMatchObject({ kind: "parity" });
      const diffs = (
        outcome.report as {
          diffs: Array<{ kind: string; identifierId: string }>;
        }
      ).diffs;
      expect(diffs).toContainEqual(
        expect.objectContaining({
          kind: "surplus_row",
          identifierId: staleId,
          actualState: "VERIFIED",
        }),
      );
    });

    it("ignores a surplus DETACHED tombstone and finalizes", async () => {
      const { migration } = harness({
        presetRows: [
          {
            id: staleId,
            provider: "email",
            value: normalizeIdentifierValue("old.address@acme.com"),
            accountId: null,
            state: "DETACHED",
          },
        ],
      });

      const outcome = await migration.migrateTenant({ tenantId: USER });

      expect(outcome.status).toBe("finalized");
    });
  });

  describe("when the user has no hash key yet", () => {
    it("mints one before adopting, so hashes are real from the first event", async () => {
      const { migration, minted } = harness({
        user: samUser({ userHashKey: null }),
      });
      await migration.migrateTenant({ tenantId: USER });
      expect(minted).toEqual([USER]);
    });
  });

  describe("when the user has nothing to adopt", () => {
    it("finalizes a user without an email, with the reason in the report", async () => {
      const { migration, attachIdentifier } = harness({
        user: samUser({ email: null }),
      });
      const outcome = await migration.migrateTenant({ tenantId: USER });
      // Terminal, not held: an erased or email-less user has no identifiers
      // to backfill, and a held row would be retried every pass forever. The
      // write gate opening on finalized is correct - future ceremonies
      // attach fresh identifiers live.
      expect(outcome.status).toBe("finalized");
      expect(outcome.report).toMatchObject({ kind: "no_email" });
      expect(attachIdentifier).not.toHaveBeenCalled();
    });

    it("finalizes a vanished user with nothing to adopt", async () => {
      const { migration } = harness({ user: null });
      const outcome = await migration.migrateTenant({ tenantId: USER });
      expect(outcome.status).toBe("finalized");
      expect(outcome.report).toMatchObject({ kind: "user_missing" });
    });
  });
});
