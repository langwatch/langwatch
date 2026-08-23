import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaIdentityVerificationRepository } from "../identity-verification.prisma.repository";

/**
 * The ceremony record on the real `VerificationToken` table: one record per
 * identifier (a newer mint replaces the older), the payload survives the
 * JSON round-trip, and single-use is a real delete two concurrent
 * completions cannot both win.
 */
const namespace = `idverif-${nanoid(8)}`;
const IDENTIFIER = `${namespace}-idf`;
const repository = new PrismaIdentityVerificationRepository(prisma);

function record(verificationId: string) {
  return {
    verificationId,
    userId: `${namespace}-user`,
    identifierId: IDENTIFIER,
    tokenHash: `hash-${verificationId}`,
    codeChallenge: `challenge-${verificationId}`,
    expiresAtMs: 1_800_000_000_000,
  };
}

afterEach(async () => {
  await prisma.verificationToken.deleteMany({
    where: { identifier: `identity-verify:${IDENTIFIER}` },
  });
});

describe("PrismaIdentityVerificationRepository", () => {
  describe("when a record is minted", () => {
    it("round-trips the whole record under the identifier's key", async () => {
      await repository.replaceForIdentifier(record("verif_1"));

      expect(
        await repository.findByIdentifierId({ identifierId: IDENTIFIER }),
      ).toEqual(record("verif_1"));
    });
  });

  describe("when a newer record is minted for the same identifier", () => {
    it("replaces the older one: exactly one row, the newest", async () => {
      await repository.replaceForIdentifier(record("verif_1"));
      await repository.replaceForIdentifier(record("verif_2"));

      expect(
        await prisma.verificationToken.count({
          where: { identifier: `identity-verify:${IDENTIFIER}` },
        }),
      ).toBe(1);
      expect(
        (await repository.findByIdentifierId({ identifierId: IDENTIFIER }))
          ?.verificationId,
      ).toBe("verif_2");
      expect(
        await repository.consume({
          identifierId: IDENTIFIER,
          verificationId: "verif_1",
        }),
      ).toBe(false);
    });
  });

  describe("when two completions race to consume the same record", () => {
    it("exactly one wins, and the record is gone afterwards", async () => {
      await repository.replaceForIdentifier(record("verif_1"));

      const outcomes = await Promise.all([
        repository.consume({
          identifierId: IDENTIFIER,
          verificationId: "verif_1",
        }),
        repository.consume({
          identifierId: IDENTIFIER,
          verificationId: "verif_1",
        }),
      ]);

      expect(outcomes.filter(Boolean)).toHaveLength(1);
      expect(
        await repository.findByIdentifierId({ identifierId: IDENTIFIER }),
      ).toBeNull();
    });
  });
});
