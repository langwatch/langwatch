/**
 * The address lock, against real Postgres (ADR-116 §6).
 *
 * Only a database can carry this claim. "Read whether anybody holds the
 * address, then state the fact" passes for both sides of a race; a primary key
 * does not, and the loser reads the winner's row back rather than writing its
 * own. Everything else here — who may re-claim, when a lock is released, what
 * counts as an orphan — is the shape that keeps the lock from becoming an
 * address nobody can ever take again.
 *
 * Corresponds to specs/identity/identity-storage-adapter.feature.
 */
import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaIdentityReservationRepository } from "../identity-reservations.prisma.repository";

const namespace = `idres-${nanoid(8)}`;
const repository = new PrismaIdentityReservationRepository(prisma);
const VALUE = `${namespace}@acme.com`;
const MINE = `${namespace}-mine`;
const THEIRS = `${namespace}-theirs`;

afterEach(async () => {
  await prisma.identifierReservation.deleteMany({
    where: { normalizedValue: { startsWith: namespace } },
  });
  await prisma.identifier.deleteMany({
    where: { userId: { startsWith: namespace } },
  });
});

describe("PrismaIdentityReservationRepository", () => {
  describe("when two users claim one address", () => {
    /** @scenario "Two concurrent verifications of one address: the loser is refused before any fact" */
    it("answers the first claimant to both, so the second knows it lost", async () => {
      const first = await repository.claim({
        normalizedValue: VALUE,
        userId: MINE,
        identifierId: "idf_mine",
        commandId: "idcmd_mine",
      });
      const second = await repository.claim({
        normalizedValue: VALUE,
        userId: THEIRS,
        identifierId: "idf_theirs",
        commandId: "idcmd_theirs",
      });

      expect(first.userId).toBe(MINE);
      expect(second.userId).toBe(MINE);
      expect(
        await prisma.identifierReservation.count({
          where: { normalizedValue: VALUE },
        }),
      ).toBe(1);
    });

    /** @scenario "A retried verification holds the lock it already took" */
    it("answers the same command's own claim back to it, so a retry converges", async () => {
      await repository.claim({
        normalizedValue: VALUE,
        userId: MINE,
        identifierId: "idf_mine",
        commandId: "idcmd_mine",
      });

      const retried = await repository.claim({
        normalizedValue: VALUE,
        userId: MINE,
        identifierId: "idf_mine",
        commandId: "idcmd_mine",
      });

      expect(retried).toMatchObject({ userId: MINE, commandId: "idcmd_mine" });
    });
  });

  describe("when a user stops holding the value", () => {
    /** @scenario "Unlinking an address frees it for somebody else" */
    it("releases every claim of theirs that no named identifier backs", async () => {
      await repository.claim({
        normalizedValue: VALUE,
        userId: MINE,
        identifierId: "idf_gone",
        commandId: "idcmd_mine",
      });

      const released = await repository.release({
        userId: MINE,
        holdingIdentifierIds: ["idf_still_here"],
      });

      expect(released).toBe(1);
      // And the address is somebody else's to take.
      expect(
        (
          await repository.claim({
            normalizedValue: VALUE,
            userId: THEIRS,
            identifierId: "idf_theirs",
            commandId: "idcmd_theirs",
          })
        ).userId,
      ).toBe(THEIRS);
    });

    it("keeps a claim a live identifier still backs", async () => {
      await repository.claim({
        normalizedValue: VALUE,
        userId: MINE,
        identifierId: "idf_mine",
        commandId: "idcmd_mine",
      });

      expect(
        await repository.release({
          userId: MINE,
          holdingIdentifierIds: ["idf_mine"],
        }),
      ).toBe(0);
    });
  });

  describe("when a claim's fact never landed", () => {
    /** @scenario "An address lock whose fact never landed is reaped" */
    it("reaps it past the horizon, and leaves a younger one alone", async () => {
      await prisma.identifierReservation.create({
        data: {
          normalizedValue: VALUE,
          userId: MINE,
          identifierId: "idf_never_landed",
          commandId: "idcmd_mine",
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });
      const fresh = `${namespace}-fresh@acme.com`;
      await repository.claim({
        normalizedValue: fresh,
        userId: MINE,
        identifierId: "idf_in_flight",
        commandId: "idcmd_fresh",
      });

      const reaped = await repository.reapOrphans({
        olderThan: new Date(Date.now() - 60 * 60 * 1000),
        limit: 100,
      });

      expect(reaped).toBe(1);
      // The younger claim belongs to a ceremony that may still be in flight,
      // and reaping it would hand its address to somebody else mid-ceremony.
      expect(
        await prisma.identifierReservation.findUnique({
          where: { normalizedValue: fresh },
        }),
      ).not.toBeNull();
    });

    it("leaves a claim a live identifier backs, however old", async () => {
      await prisma.identifier.create({
        data: {
          id: "idf_live",
          userId: MINE,
          provider: "email",
          value: VALUE,
          state: "VERIFIED",
          attachedAt: new Date(),
        },
      });
      await prisma.identifierReservation.create({
        data: {
          normalizedValue: VALUE,
          userId: MINE,
          identifierId: "idf_live",
          commandId: "idcmd_mine",
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });

      expect(
        await repository.reapOrphans({
          olderThan: new Date(Date.now() - 60 * 60 * 1000),
          limit: 100,
        }),
      ).toBe(0);
    });
  });
});
