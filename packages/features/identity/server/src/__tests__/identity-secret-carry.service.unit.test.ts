/**
 * Both pass-time directions of the bridge mirror's row half (ADR-116 §4).
 *
 * The forward direction is the adapter's, at write time. These two are the
 * pass's, and they differ only in whether the credential row exists yet: a
 * missing one is a user LATCHING, an older one is a secret that landed on
 * the legacy branch after they latched.
 *
 * The second is the one that is easy to get wrong and impossible to notice.
 * A finalized user's password change can still reach the legacy branch —
 * deterministically for up to the write gate's TTL per pod right after their
 * latch — and their sign-in then reads `AccountCredential`. Without the heal
 * leg that password is rejected forever, and nothing in the system says so.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  AccountSecretPair,
  IdentitySecretCarryRepository,
} from "../identity-secret-carry.service";
import { IdentitySecretCarryService } from "../identity-secret-carry.service";

const USER = "user_olga";
const T0 = 1_690_000_000_000;

function harness(pairs: AccountSecretPair[]) {
  const insertCredentialIfMissing = vi.fn(async () => true);
  const overwriteCredential = vi.fn(async () => undefined);
  const reads: IdentitySecretCarryRepository = {
    findAccountSecretPairs: async () => pairs,
    insertCredentialIfMissing,
    overwriteCredential,
  };
  return {
    service: new IdentitySecretCarryService(reads),
    insertCredentialIfMissing,
    overwriteCredential,
  };
}

const pair = (overrides?: Partial<AccountSecretPair>): AccountSecretPair => ({
  accountId: "acc_1",
  userId: USER,
  providerId: "credential",
  accountCreatedAtMs: T0,
  accountUpdatedAtMs: T0,
  credentialUpdatedAtMs: null,
  secrets: { password: "hashed-legacy-password" },
  ...overrides,
});

describe("carrying account secrets onto credential rows", () => {
  describe("given a user whose backfill has just finalized", () => {
    describe("when the carry runs", () => {
      it("creates the credential row with the Account row's own timestamps", async () => {
        const { service, insertCredentialIfMissing } = harness([
          pair({ accountCreatedAtMs: T0 - 5_000, accountUpdatedAtMs: T0 }),
        ]);

        const outcome = await service.carryForUser({ userId: USER });

        expect(insertCredentialIfMissing).toHaveBeenCalledWith({
          accountId: "acc_1",
          userId: USER,
          providerId: "credential",
          secrets: { password: "hashed-legacy-password" },
          // The credential is a copy of something that already happened, so
          // it carries the original's time. Stamping it `now()` would make
          // every later comparison lie about which branch wrote last.
          createdAtMs: T0 - 5_000,
          updatedAtMs: T0,
        });
        expect(outcome).toEqual({ carried: 1, healed: 0 });
      });

      it("inserts nothing the second time it runs", async () => {
        const { service, insertCredentialIfMissing, overwriteCredential } = harness([pair()]);
        insertCredentialIfMissing.mockResolvedValue(false);

        const outcome = await service.carryForUser({ userId: USER });

        // The row was already there; the repository's insert is a no-op and
        // the service does not fall through to an overwrite.
        expect(outcome).toEqual({ carried: 0, healed: 0 });
        expect(overwriteCredential).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a finalized user whose password change landed on the legacy branch", () => {
    describe("when the heal pass runs", () => {
      /** @scenario "A secret written on the legacy branch after latch is healed" */
      it("copies the newer Account secrets onto the credential row", async () => {
        const { service, overwriteCredential } = harness([
          pair({
            credentialUpdatedAtMs: T0,
            accountUpdatedAtMs: T0 + 60_000,
            secrets: { password: "hashed-new-password" },
          }),
        ]);

        const outcome = await service.carryForUser({ userId: USER });

        // Her next sign-in reads AccountCredential, so this row IS what
        // decides whether the password she just set works.
        expect(overwriteCredential).toHaveBeenCalledWith({
          accountId: "acc_1",
          secrets: { password: "hashed-new-password" },
          updatedAtMs: T0 + 60_000,
        });
        expect(outcome).toEqual({ carried: 0, healed: 1 });
      });

      it("leaves a credential row the identity branch wrote more recently alone", async () => {
        const { service, overwriteCredential } = harness([
          pair({
            credentialUpdatedAtMs: T0 + 60_000,
            accountUpdatedAtMs: T0,
          }),
        ]);

        const outcome = await service.carryForUser({ userId: USER });

        expect(overwriteCredential).not.toHaveBeenCalled();
        expect(outcome).toEqual({ carried: 0, healed: 0 });
      });

      it("does nothing when the two agree, so a quiet pass writes nothing", async () => {
        const { service, overwriteCredential } = harness([
          pair({ credentialUpdatedAtMs: T0, accountUpdatedAtMs: T0 }),
        ]);

        const outcome = await service.carryForUser({ userId: USER });

        // Equal-does-nothing is what keeps every pass from rewriting every
        // credential row it looks at, forever.
        expect(overwriteCredential).not.toHaveBeenCalled();
        expect(outcome).toEqual({ carried: 0, healed: 0 });
      });
    });
  });

  describe("given a user holding both a stale credential and an uncarried account", () => {
    describe("when the pass runs", () => {
      it("heals one and carries the other in the same sweep", async () => {
        const { service, insertCredentialIfMissing, overwriteCredential } = harness([
          pair({
            accountId: "acc_stale",
            credentialUpdatedAtMs: T0,
            accountUpdatedAtMs: T0 + 1,
          }),
          pair({ accountId: "acc_new", credentialUpdatedAtMs: null }),
        ]);

        const outcome = await service.carryForUser({ userId: USER });

        expect(overwriteCredential).toHaveBeenCalledTimes(1);
        expect(insertCredentialIfMissing).toHaveBeenCalledTimes(1);
        expect(outcome).toEqual({ carried: 1, healed: 1 });
      });
    });
  });
});
