import {
  type AttachIdentifierCommandData,
  arrivalStateForProvider,
  type BackfillIdentifierRow,
  type DetachIdentifierCommandData,
  IdentityIdentifierNotFoundError,
  IdentityIdentifierNotVerifiableError,
  IdentityPrimaryMustDemoteFirstError,
  normalizeIdentifierValue,
  type VerifyIdentifierCommandData,
} from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";
import { deriveIdentifierId } from "../crypto/identifier-identity";
import type { BackfillAccountRow, BackfillUserRow } from "../identity-backfill.repository";
import { IdentityBackfillService } from "../identity-backfill.service";
import { IdentitySecretCarryService } from "../identity-secret-carry.service";

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
    // The row's own issuer, which the adoption carries onto the fact rather
    // than re-deriving — Google's is a real URL, not a synthetic form.
    issuer: "https://accounts.google.com",
    providerAccountId: "google-sub-123",
    createdAtMs: ACCOUNT_CREATED_AT,
  };
}

/**
 * The harness's identity service mirrors the real calling-path dispatch
 * faithfully where it matters to this pass: attach folds an Identifier row
 * with the same deterministic id derivation and arrival state, verify
 * promotes ATTACHED and refuses the states the real guard refuses — so the
 * parity proof runs against rows shaped exactly like the fold's.
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
  const minted: { userId: string; userHashKey: string }[] = [];

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
    if (!row) throw new IdentityIdentifierNotFoundError("no such identifier");
    if (row.state === "VERIFIED" || row.state === "PRIMARY") return [];
    if (row.state !== "ATTACHED") {
      throw new IdentityIdentifierNotVerifiableError(`identifier is ${row.state}`);
    }
    row.state = "VERIFIED";
    return [];
  });

  const detachIdentifier = vi.fn(async (data: DetachIdentifierCommandData) => {
    const row = rows.get(data.identifierId);
    if (!row) throw new IdentityIdentifierNotFoundError("no such identifier");
    if (row.state === "PRIMARY") {
      throw new IdentityPrimaryMustDemoteFirstError("primary identifiers never detach directly");
    }
    row.state = "DETACHED";
    return [];
  });

  const carried: string[] = [];
  const service = new IdentityBackfillService(
    {
      tryFindUser: async () => user,
      findAccountRows: async () => accounts,
      findIdentifierRows: async () => [...rows.values()],
    },
    {
      storeUserHashKeyIfMissing: async (args) => {
        minted.push(args);
      },
      // The backfill never reads either of these - the plan takes the email
      // off the user row it already read, and the collision guard is the one
      // asking who holds an address - but the double is the whole port.
      findEmail: async () => user?.email ?? null,
      findUserIdByEmail: async () => null,
    },
    { attachIdentifier, verifyIdentifier, detachIdentifier },
    // The latch's secret carry (ADR-116 §4). Recorded rather than performed:
    // WHEN it runs is this pass's contract — only for a user the proof
    // finalized — and WHAT it copies is its own suite's.
    new IdentitySecretCarryService({
      findAccountSecretPairs: async () => {
        carried.push("looked");
        return [];
      },
      insertCredentialIfMissing: async () => true,
      overwriteCredential: async () => undefined,
    }),
    { now: () => 1_800_000_000_000 },
  );

  return {
    service,
    rows,
    minted,
    carried,
    attachIdentifier,
    verifyIdentifier,
    detachIdentifier,
  };
}

describe("the identifier backfill pass", () => {
  describe("when a user with legacy Account rows and a verified email migrates", () => {
    /** @scenario "The backfill adopts existing accounts and proves itself per user" */
    it("adopts with each source row's own business time and finalizes only on parity", async () => {
      const { service, attachIdentifier } = harness();

      const outcome = await service.migrateUser({ userId: USER });

      expect(outcome.status).toBe("finalized");
      expect(outcome.report).toMatchObject({ kind: "adopted", identifiers: 2 });
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
      const { service, attachIdentifier } = harness();
      await service.migrateUser({ userId: USER });
      const firstIds = attachIdentifier.mock.calls.map(([data]) => data.commandId);
      const outcome = await service.migrateUser({ userId: USER });
      expect(outcome.status).toBe("finalized");
      const secondIds = attachIdentifier.mock.calls
        .slice(firstIds.length)
        .map(([data]) => data.commandId);
      expect(secondIds).toEqual(firstIds);
    });

    it("carries the user's secrets across only once the proof finalizes them", async () => {
      const { service, carried } = harness();

      await service.migrateUser({ userId: USER });

      // ADR-116 §4: before the latch every secret they can sign in with
      // lives only in `Account`; after the gate opens their sign-in reads
      // `AccountCredential`. A finalization without this step latches a user
      // whose very next sign-in verifies against an empty credential row.
      expect(carried).toEqual(["looked"]);
    });
  });

  describe("when an adopted Account row is gone on a later pass", () => {
    /** @scenario "The backfill detaches identifiers whose account row is gone" */
    it("detaches the orphaned identifier with a stable command id and finalizes", async () => {
      const first = harness();
      await first.service.migrateUser({ userId: USER });
      const googleRow = [...first.rows.values()].find((row) => row.provider === "google");
      expect(googleRow?.state).toBe("VERIFIED");

      const second = harness({ accounts: [], presetRows: [...first.rows.values()] });
      const outcome = await second.service.migrateUser({ userId: USER });

      expect(outcome.status).toBe("finalized");
      expect(second.detachIdentifier).toHaveBeenCalledTimes(1);
      expect(second.detachIdentifier.mock.calls[0]?.[0]).toMatchObject({
        identifierId: googleRow?.id,
        commandId: `backfill:detach:${googleRow?.id}:${googleRow?.accountId}`,
        actor: { type: "system", id: "system:identity-backfill" },
      });
      expect(second.rows.get(googleRow?.id ?? "")?.state).toBe("DETACHED");
      const emailRow = [...second.rows.values()].find((row) => row.provider === "email");
      expect(emailRow?.state).not.toBe("DETACHED");
    });

    it("never detaches twice: an already-detached identifier is left alone", async () => {
      const first = harness();
      await first.service.migrateUser({ userId: USER });
      const second = harness({ accounts: [], presetRows: [...first.rows.values()] });
      await second.service.migrateUser({ userId: USER });
      const third = harness({ accounts: [], presetRows: [...second.rows.values()] });

      await third.service.migrateUser({ userId: USER });

      expect(third.detachIdentifier).not.toHaveBeenCalled();
    });
  });

  describe("when the fold-built rows disagree with what the live rows imply", () => {
    it("holds the user at migrated with a diff report, never finalizes", async () => {
      const { service, carried } = harness({ applyCeremonies: false });

      const outcome = await service.migrateUser({ userId: USER });

      expect(outcome.status).toBe("migrated");
      expect(outcome.report).toMatchObject({ kind: "parity" });
      const diffs = (outcome.report as { diffs: Array<{ kind: string }> }).diffs;
      expect(diffs.length).toBeGreaterThan(0);
      expect(diffs[0]?.kind).toBe("identifier_missing");
      // A held user's `Account` rows are still authoritative, so their
      // secrets stay where they are: carrying them would be writing the
      // identity branch's half of a split the proof has not agreed to.
      expect(carried).toEqual([]);
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
      const { service } = harness({
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

      const outcome = await service.migrateUser({ userId: USER });

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
      const { service } = harness({
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

      const outcome = await service.migrateUser({ userId: USER });

      expect(outcome.status).toBe("migrated");
      const diffs = (outcome.report as { diffs: Array<{ kind: string; identifierId: string }> })
        .diffs;
      expect(diffs).toContainEqual(
        expect.objectContaining({
          kind: "surplus_row",
          identifierId: staleId,
          actualState: "VERIFIED",
        }),
      );
    });

    it("ignores a surplus DETACHED tombstone and finalizes", async () => {
      const { service } = harness({
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

      const outcome = await service.migrateUser({ userId: USER });

      expect(outcome.status).toBe("finalized");
    });
  });

  describe("when the user has no hash key yet", () => {
    it("mints one before adopting, so hashes are real from the first fact", async () => {
      const { service, minted } = harness({ user: samUser({ userHashKey: null }) });
      await service.migrateUser({ userId: USER });
      expect(minted).toHaveLength(1);
      expect(minted[0]).toMatchObject({ userId: USER });
      expect(minted[0]?.userHashKey).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("when the user has nothing to adopt", () => {
    it("finalizes a user without an email, with the reason in the report", async () => {
      const { service, attachIdentifier } = harness({ user: samUser({ email: null }) });
      const outcome = await service.migrateUser({ userId: USER });
      expect(outcome.status).toBe("finalized");
      expect(outcome.report).toMatchObject({ kind: "no_email" });
      expect(attachIdentifier).not.toHaveBeenCalled();
    });

    it("finalizes a vanished user with nothing to adopt", async () => {
      const { service } = harness({ user: null });
      const outcome = await service.migrateUser({ userId: USER });
      expect(outcome.status).toBe("finalized");
      expect(outcome.report).toMatchObject({ kind: "user_missing" });
    });
  });
});
