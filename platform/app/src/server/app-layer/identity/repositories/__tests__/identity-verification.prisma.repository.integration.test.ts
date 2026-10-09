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

const KEY = `identity-verify:${IDENTIFIER}`;

/**
 * The two-row state a mint race actually leaves. `identifier` carries no
 * unique constraint, so both mints found nothing to replace and both
 * inserted; `createdAt` is stamped explicitly because two inserts in the same
 * millisecond would leave "the newest" ambiguous, and this suite's whole
 * claim is about which generation is current.
 *
 * Written through the client rather than the repository, because the
 * repository's own mint is what would delete the first row.
 */
async function bothGenerationsLanded(): Promise<void> {
  const stamps = [
    new Date(1_700_000_000_000),
    new Date(1_700_000_060_000),
  ] as const;
  for (const [index, verificationId] of [
    "verif_older",
    "verif_newer",
  ].entries()) {
    const { expiresAtMs, ...payload } = record(verificationId);
    await prisma.verificationToken.create({
      data: {
        identifier: KEY,
        token: JSON.stringify({ v: 1, ...payload }),
        expires: new Date(expiresAtMs),
        createdAt: stamps[index],
      },
    });
  }
}

afterEach(async () => {
  await prisma.verificationToken.deleteMany({ where: { identifier: KEY } });
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

  describe("when two mints raced and both rows landed", () => {
    /** @scenario "A superseded verification link can never complete" */
    it("consuming the newest reaps the older one, so its link is dead", async () => {
      await bothGenerationsLanded();
      expect(
        (await repository.findByIdentifierId({ identifierId: IDENTIFIER }))
          ?.verificationId,
      ).toBe("verif_newer");

      expect(
        await repository.consume({
          identifierId: IDENTIFIER,
          verificationId: "verif_newer",
        }),
      ).toBe(true);

      // Without reaping, the older row would answer this read and its token
      // and PKCE proof would still complete — a link a newer mint was
      // supposed to invalidate, working after the newer one was used.
      expect(
        await repository.findByIdentifierId({ identifierId: IDENTIFIER }),
      ).toBeNull();
      expect(
        await repository.consume({
          identifierId: IDENTIFIER,
          verificationId: "verif_older",
        }),
      ).toBe(false);
      expect(
        await prisma.verificationToken.count({ where: { identifier: KEY } }),
      ).toBe(0);
    });

    it("refuses the older link even before the newer one is used", async () => {
      await bothGenerationsLanded();

      expect(
        await repository.consume({
          identifierId: IDENTIFIER,
          verificationId: "verif_older",
        }),
      ).toBe(false);
      // And the refusal took nothing with it: the current generation still
      // completes.
      expect(
        await repository.consume({
          identifierId: IDENTIFIER,
          verificationId: "verif_newer",
        }),
      ).toBe(true);
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
