import { describe, expect, it } from "vitest";
import type { IdentityRepositories } from "../../identity.repositories.ts";
import { MemoryIdentityStore } from "../memory-identity.store.ts";
import { MemoryIdentityRepositories } from "../memory.identity.repositories.ts";

/**
 * The cases every identity backend answers the same way. The memory tier runs
 * them here; the Prisma tier runs them in the package's datastore lane over
 * the same expectations.
 */
function scenario(): { store: MemoryIdentityStore; repositories: IdentityRepositories } {
  const store = MemoryIdentityStore.create();

  return { store, repositories: MemoryIdentityRepositories.over(store) };
}

function seedUser(store: MemoryIdentityStore, userId: string, email: string | null): void {
  store.users.set(userId, {
    id: userId,
    email,
    emailVerified: email !== null,
    createdAtMs: 1_700_000_000_000,
    userHashKey: null,
    payload: {},
  });
}

describe("given the memory identity repositories", () => {
  describe("when a user hash key is minted twice", () => {
    it("keeps the first key", async () => {
      const { store, repositories } = scenario();
      seedUser(store, "user_1", "sam@acme.com");

      await repositories.users.storeUserHashKeyIfMissing({ userId: "user_1", userHashKey: "k1" });
      await repositories.users.storeUserHashKeyIfMissing({ userId: "user_1", userHashKey: "k2" });

      expect(await repositories.heads.tryFindUserHashKey({ userId: "user_1" })).toBe("k1");
    });
  });

  describe("when an address is held on the legacy branch", () => {
    it("answers the holder case-insensitively", async () => {
      const { store, repositories } = scenario();
      seedUser(store, "user_1", "Sam@Acme.com");

      expect(
        await repositories.users.tryFindUserIdByEmail({ normalizedValue: "sam@acme.com" }),
      ).toBe("user_1");
    });
  });

  describe("when a normalized value is already reserved", () => {
    it("answers the standing holder rather than taking the claim", async () => {
      const { repositories } = scenario();
      const first = await repositories.reservations.claim({
        normalizedValue: "sam@acme.com",
        userId: "user_1",
        identifierId: "idf_1",
        commandId: "cmd_1",
      });
      const second = await repositories.reservations.claim({
        normalizedValue: "sam@acme.com",
        userId: "user_2",
        identifierId: "idf_2",
        commandId: "cmd_2",
      });

      expect(first.userId).toBe("user_1");
      expect(second.userId).toBe("user_1");
    });
  });

  describe("when a verification is consumed", () => {
    it("consumes once and refuses the replay", async () => {
      const { repositories } = scenario();
      await repositories.verification.replaceForIdentifier({
        verificationId: "ver_1",
        userId: "user_1",
        identifierId: "idf_1",
        tokenHash: "hash",
        codeChallenge: "challenge",
        expiresAtMs: 1_700_000_100_000,
      });

      expect(
        await repositories.verification.consume({
          identifierId: "idf_1",
          verificationId: "ver_1",
        }),
      ).toBe(true);
      expect(
        await repositories.verification.consume({
          identifierId: "idf_1",
          verificationId: "ver_1",
        }),
      ).toBe(false);
    });
  });

  describe("when a user has no enrollment", () => {
    it("reads the empty state rather than null", async () => {
      const { repositories } = scenario();
      const enrollment = await repositories.mfaEnrollment.findEnrollment({ userId: "user_1" });

      expect(enrollment.userId).toBe("user_1");
      expect(enrollment.enrollmentId).toBeNull();
    });
  });

  describe("when requests are waiting on one organization", () => {
    it("lists only the pending ones, newest ask first", async () => {
      const { store, repositories } = scenario();
      const base = {
        userId: "user_1",
        organizationId: "org_1",
        domain: "acme.com",
        matchedVia: "verified-identifier-domain" as const,
        updatedAtMs: 0,
        expiresAtMs: null,
        resolvedAtMs: null,
        resolvedByType: null,
        resolvedById: null,
        withdrawalCause: null,
      };
      store.joinRequests.set("jr_1", {
        ...base,
        joinRequestId: "jr_1",
        state: "PENDING",
        createdAtMs: 1,
      });
      store.joinRequests.set("jr_2", {
        ...base,
        joinRequestId: "jr_2",
        state: "PENDING",
        createdAtMs: 2,
      });
      store.joinRequests.set("jr_3", {
        ...base,
        joinRequestId: "jr_3",
        state: "APPROVED",
        createdAtMs: 3,
      });

      const pending = await repositories.joinRequests.findPendingForOrganization({
        organizationId: "org_1",
      });

      expect(pending.map((request) => request.joinRequestId)).toEqual(["jr_2", "jr_1"]);
    });
  });
});
