import { describe, expect, it, vi } from "vitest";
import type { VerifyIdentifierCommandData } from "~/server/event-sourcing/pipelines/identity/schemas/commands";
import {
  IDENTITY_VERIFICATION_TTL_MS,
  IdentityVerificationInvalidError,
  type IdentityVerificationRecord,
  type IdentityVerificationStore,
  s256Challenge,
  VerificationCeremonyService,
} from "../verification-ceremony";

const USER = "user_sam";
const WORK = "idf_work";
const PERSONAL = "idf_personal";

/** In-memory mirror of the Prisma repository's replace/find/consume shape. */
class InMemoryVerificationStore implements IdentityVerificationStore {
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
  identifierState?: string;
  now?: () => number;
  latched?: boolean;
}) {
  const store = new InMemoryVerificationStore();
  const verifyIdentifier = vi.fn(
    async (_data: VerifyIdentifierCommandData) => [],
  );
  const service = new VerificationCeremonyService({
    store,
    identifiers: {
      findIdentifier: async ({ identifierId }) =>
        identifierId === WORK || identifierId === PERSONAL
          ? {
              provider: "email",
              state: options?.identifierState ?? "ATTACHED",
            }
          : null,
    },
    ceremonies: { verifyIdentifier: verifyIdentifier as never },
    isLatched: async () => options?.latched ?? true,
    now: options?.now,
  });
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

  describe("when the user's identifier backfill is not finalized", () => {
    /** @scenario "The adapter's write gate ships closed for every user" */
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
      expect(store.records.get(WORK)?.verificationId).toBe(
        minted.verificationId,
      );
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
      await expect(
        service.completeEmailVerification(completion),
      ).rejects.toMatchObject({ code: "identity_verification_invalid" });
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
  });
});
