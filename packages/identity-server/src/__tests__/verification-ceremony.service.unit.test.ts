import {
  emptyIdentityHeads,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IdentityEmailInUseError,
  IdentityVerificationInvalidError,
  type VerifyIdentifierCommandData,
} from "@langwatch/identity";
import { describe, expect, it, vi } from "vitest";
import { s256Challenge } from "../crypto/pkce";
import type {
  IdentityVerificationRecord,
  IdentityVerificationRepository,
} from "../identity-verification.repository";
import {
  IDENTITY_VERIFICATION_TTL_MS,
  VerificationCeremonyService,
} from "../verification-ceremony.service";
import { fact, USER } from "./support/in-memory-heads";

const WORK = "idf_work";
const PERSONAL = "idf_personal";

/** In-memory mirror of the Prisma repository's replace/find/consume shape. */
export class InMemoryVerificationStore implements IdentityVerificationRepository {
  records = new Map<string, IdentityVerificationRecord>();

  async replaceForIdentifier(record: IdentityVerificationRecord) {
    this.records.set(record.identifierId, record);
  }

  async findByIdentifierId({ identifierId }: { identifierId: string }) {
    return this.records.get(identifierId) ?? null;
  }

  async consume({
    identifierId,
    verificationId,
  }: {
    identifierId: string;
    verificationId: string;
  }) {
    const record = this.records.get(identifierId);
    if (!record || record.verificationId !== verificationId) return false;
    this.records.delete(identifierId);
    return true;
  }
}

function harness(options?: {
  identifierState?: "ATTACHED" | "VERIFIED";
  identifierProvider?: "email" | "google";
  now?: () => number;
  latched?: boolean;
  /** The guard's emission: a dead end is how a uniqueness race resolves on a
   *  side that reached the command before the lock could refuse it. */
  emits?: () => unknown[];
}) {
  const store = new InMemoryVerificationStore();
  const verifyIdentifier = vi.fn(
    async (_data: VerifyIdentifierCommandData): Promise<unknown[]> =>
      options?.emits?.() ?? [],
  );
  const service = new VerificationCeremonyService(
    store,
    {
      findIdentifier: async ({ identifierId }) =>
        identifierId === WORK || identifierId === PERSONAL
          ? fact({
              identifierId,
              provider: options?.identifierProvider ?? "email",
              state: options?.identifierState ?? "ATTACHED",
            })
          : null,
      // The ceremony reads exactly one head; the rest of the port is
      // present so the double is the contract, not a slice of it.
      findUserHashKey: async () => null,
      hasFolded: async () => true,
      findHeads: async ({ userId }) => emptyIdentityHeads({ userId }),
      findActiveIdentifierByValue: async () => null,
      findIdentifierIdForAccount: async () => null,
    },
    { verifyIdentifier: verifyIdentifier as never },
    {
      isLatched: async () => options?.latched ?? true,
      ...(options?.now ? { now: options.now } : {}),
    },
  );
  return { store, service, verifyIdentifier };
}

describe("the email verification ceremony", () => {
  describe("when completion presents the token and the matching PKCE verifier", () => {
    /** @scenario "Email verification completes only with the ceremony's proof" */
    it("verifies via a verify_identifier command carrying the verificationId", async () => {
      const { service, verifyIdentifier } = harness();
      const codeVerifier = "the-initiating-context-secret";
      const minted = await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge(codeVerifier),
      });

      await service.completeEmailVerification({
        userId: USER,
        identifierId: WORK,
        verificationId: minted.verificationId,
        token: minted.token,
        codeVerifier,
      });

      expect(verifyIdentifier).toHaveBeenCalledTimes(1);
      expect(verifyIdentifier.mock.calls[0]?.[0]).toMatchObject({
        userId: USER,
        identifierId: WORK,
        verificationId: minted.verificationId,
        method: "magic-link",
      });
    });

    it("refuses the emailed token alone when the verifier does not match", async () => {
      const { service, verifyIdentifier } = harness();
      const minted = await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge("the-real-verifier"),
      });

      await expect(
        service.completeEmailVerification({
          userId: USER,
          identifierId: WORK,
          verificationId: minted.verificationId,
          token: minted.token,
          codeVerifier: "a-forwarded-link-holder-guessing",
        }),
      ).rejects.toMatchObject({ code: "identity_verification_invalid" });
      expect(verifyIdentifier).not.toHaveBeenCalled();
    });
  });

  describe("when the guard refuses the address as already held", () => {
    /**
     * ADR-116 §6. Two claims, and the second is the one that is easy to
     * lose: the code survives the ceremony — so the client registry can turn
     * `identity_email_in_use` into copy rather than showing the raw string —
     * AND the single-use proof is still there afterwards. What buys the
     * second one is the ceremony's own ordering: dispatch, THEN consume. A
     * refusal must not burn a link the customer will need again once they
     * have freed the address.
     */
    /** @scenario "A guard refusal reaches the customer as named copy" */
    it("keeps the handled code and leaves the verification proof unconsumed", async () => {
      const { store, service, verifyIdentifier } = harness();
      verifyIdentifier.mockRejectedValue(
        new IdentityEmailInUseError(
          "verify_identifier: a user outside the identity population already holds this address",
        ),
      );
      const codeVerifier = "the-initiating-context-secret";
      const minted = await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge(codeVerifier),
      });
      const complete = () =>
        service.completeEmailVerification({
          userId: USER,
          identifierId: WORK,
          verificationId: minted.verificationId,
          token: minted.token,
          codeVerifier,
        });

      await expect(complete()).rejects.toMatchObject({
        code: "identity_email_in_use",
      });
      expect(store.records.get(WORK)?.verificationId).toBe(
        minted.verificationId,
      );

      // The proof outlived the refusal, so the very same link completes once
      // the collision is gone.
      verifyIdentifier.mockResolvedValue([]);
      await expect(complete()).resolves.toBeUndefined();
      expect(store.records.has(WORK)).toBe(false);
    });
  });

  describe("when the emission dead-ends on a uniqueness race", () => {
    /** @scenario "A verification that loses a uniqueness race reports the collision" */
    it("reports the collision instead of a completed verification, and keeps the proof", async () => {
      const { service, store } = harness({
        emits: () => [
          {
            type: IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
            data: {
              identifierId: WORK,
              reason: "uniqueness_race_lost",
              actor: { type: "user", id: USER },
            },
            occurredAt: 1,
          },
        ],
      });
      const codeVerifier = "the-initiating-context-secret";
      const minted = await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge(codeVerifier),
      });

      await expect(
        service.completeEmailVerification({
          userId: USER,
          identifierId: WORK,
          verificationId: minted.verificationId,
          token: minted.token,
          codeVerifier,
        }),
      ).rejects.toMatchObject({ code: "identity_email_in_use" });

      // The identifier dead-ended, so the token can verify nothing — and a
      // ceremony that rejected the proof must not have charged for it.
      expect(store.records.get(WORK)).toBeDefined();
    });
  });

  describe("when the user's identifier backfill is not finalized", () => {
    /** @scenario "The write gate ships closed for every user" */
    it("refuses completion before any command: no live event precedes the user's history", async () => {
      const { service, verifyIdentifier } = harness({ latched: false });
      const codeVerifier = "secret";
      const minted = await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge(codeVerifier),
      });

      await expect(
        service.completeEmailVerification({
          userId: USER,
          identifierId: WORK,
          verificationId: minted.verificationId,
          token: minted.token,
          codeVerifier,
        }),
      ).rejects.toMatchObject({ code: "identity_verification_invalid" });
      expect(verifyIdentifier).not.toHaveBeenCalled();
    });
  });

  describe("when completion names a different identifier than the record pins", () => {
    /** @scenario "A verification token is pinned to the identifier it was minted for" */
    it("refuses and verifies nothing", async () => {
      const { service, store, verifyIdentifier } = harness();
      const codeVerifier = "verifier";
      const minted = await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge(codeVerifier),
      });

      await expect(
        service.completeEmailVerification({
          userId: USER,
          identifierId: PERSONAL,
          verificationId: minted.verificationId,
          token: minted.token,
          codeVerifier,
        }),
      ).rejects.toMatchObject({ code: "identity_verification_invalid" });
      expect(verifyIdentifier).not.toHaveBeenCalled();
      // The pinned record survives, unconsumed, for the rightful completion.
      expect(store.records.get(WORK)?.verificationId).toBe(minted.verificationId);
    });
  });

  describe("when completion presents another user's session", () => {
    it("refuses, verifies nothing, and keeps the record for the pinned user", async () => {
      const { service, store, verifyIdentifier } = harness();
      const codeVerifier = "verifier";
      const minted = await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge(codeVerifier),
      });

      await expect(
        service.completeEmailVerification({
          userId: "user_intruder",
          identifierId: WORK,
          verificationId: minted.verificationId,
          token: minted.token,
          codeVerifier,
        }),
      ).rejects.toMatchObject({ code: "identity_verification_invalid" });
      expect(verifyIdentifier).not.toHaveBeenCalled();
      expect(store.records.get(WORK)?.verificationId).toBe(minted.verificationId);
    });
  });

  describe("when the verify command's persistence rejects", () => {
    it("leaves the record unconsumed so a retry of the same valid link succeeds", async () => {
      const { service, store, verifyIdentifier } = harness();
      const codeVerifier = "verifier";
      const minted = await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge(codeVerifier),
      });
      const completion = {
        userId: USER,
        identifierId: WORK,
        verificationId: minted.verificationId,
        token: minted.token,
        codeVerifier,
      };
      verifyIdentifier.mockRejectedValueOnce(new Error("clickhouse unavailable"));

      await expect(service.completeEmailVerification(completion)).rejects.toThrow(
        "clickhouse unavailable",
      );
      expect(store.records.get(WORK)?.verificationId).toBe(minted.verificationId);

      await service.completeEmailVerification(completion);
      expect(verifyIdentifier).toHaveBeenCalledTimes(2);
      expect(store.records.has(WORK)).toBe(false);
    });
  });

  describe("when the same completion is replayed", () => {
    it("finds no record the second time: single-use", async () => {
      const { service } = harness();
      const codeVerifier = "verifier";
      const minted = await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge(codeVerifier),
      });
      const completion = {
        userId: USER,
        identifierId: WORK,
        verificationId: minted.verificationId,
        token: minted.token,
        codeVerifier,
      };

      await service.completeEmailVerification(completion);
      await expect(service.completeEmailVerification(completion)).rejects.toMatchObject({
        code: "identity_verification_invalid",
      });
    });
  });

  describe("when the link is older than the ceremony's TTL", () => {
    it("refuses with the expired code, whose remediation is a new link", async () => {
      let clock = 1_000_000;
      const { service } = harness({ now: () => clock });
      const codeVerifier = "verifier";
      const minted = await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge(codeVerifier),
      });
      clock += IDENTITY_VERIFICATION_TTL_MS + 1;

      await expect(
        service.completeEmailVerification({
          userId: USER,
          identifierId: WORK,
          verificationId: minted.verificationId,
          token: minted.token,
          codeVerifier,
        }),
      ).rejects.toMatchObject({ code: "identity_verification_expired" });
    });
  });

  describe("when a newer verification is minted for the same identifier", () => {
    it("invalidates every older link", async () => {
      const { service } = harness();
      const codeVerifier = "verifier";
      const older = await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge(codeVerifier),
      });
      await service.mintEmailVerification({
        userId: USER,
        identifierId: WORK,
        codeChallenge: s256Challenge(codeVerifier),
      });

      await expect(
        service.completeEmailVerification({
          userId: USER,
          identifierId: WORK,
          verificationId: older.verificationId,
          token: older.token,
          codeVerifier,
        }),
      ).rejects.toMatchObject({ code: "identity_verification_invalid" });
    });
  });

  describe("when the identifier is not an ATTACHED email identifier of this user", () => {
    it("refuses the mint itself", async () => {
      const { service } = harness({ identifierState: "VERIFIED" });
      await expect(
        service.mintEmailVerification({
          userId: USER,
          identifierId: WORK,
          codeChallenge: s256Challenge("verifier"),
        }),
      ).rejects.toBeInstanceOf(IdentityVerificationInvalidError);
    });

    it("refuses the mint for a non-email identifier whatever its state", async () => {
      const { service } = harness({ identifierProvider: "google" });
      await expect(
        service.mintEmailVerification({
          userId: USER,
          identifierId: WORK,
          codeChallenge: s256Challenge("verifier"),
        }),
      ).rejects.toBeInstanceOf(IdentityVerificationInvalidError);
    });
  });
});
