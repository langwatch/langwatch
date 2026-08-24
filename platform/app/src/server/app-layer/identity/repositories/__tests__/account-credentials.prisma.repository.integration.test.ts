import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaAccountCredentialsRepository } from "../account-credentials.prisma.repository";

/**
 * The secrets half of a sign-in method against real Postgres (ADR-116). What
 * the unit suites fake is proven here: the ms ⇄ Date crossing, that a patch
 * distinguishes "absent" from "explicitly null", that a retried sign-up does
 * not overwrite the tokens the first attempt stored, and that one identifier
 * can hold at most one credential.
 */
const namespace = `idcred-${nanoid(8)}`;
const IDENTIFIER = `${namespace}-idf`;
const OTHER_IDENTIFIER = `${namespace}-idf-other`;
const ROW = `${namespace}-acc`;
const OTHER_ROW = `${namespace}-acc-other`;
const T0 = 1_690_000_000_000;

const repository = new PrismaAccountCredentialsRepository(prisma);

function newRow(overrides?: Partial<Parameters<typeof repository.create>[0]>) {
  return {
    id: ROW,
    identifierId: IDENTIFIER,
    type: "oauth",
    accessToken: "at_1",
    refreshToken: "rt_1",
    idToken: null,
    password: null,
    scope: "openid email",
    tokenType: "Bearer",
    sessionState: null,
    expiresAtMs: T0 + 3_600_000,
    extExpiresIn: null,
    ...overrides,
  };
}

afterEach(async () => {
  await prisma.accountCredential.deleteMany({
    where: { identifierId: { in: [IDENTIFIER, OTHER_IDENTIFIER] } },
  });
});

describe("PrismaAccountCredentialsRepository", () => {
  describe("when a sign-in method's secrets are first stored", () => {
    it("round-trips every column, timestamps as milliseconds", async () => {
      await repository.create(newRow());

      const stored = await repository.findById({ id: ROW });

      expect(stored).toMatchObject({
        id: ROW,
        identifierId: IDENTIFIER,
        type: "oauth",
        accessToken: "at_1",
        refreshToken: "rt_1",
        idToken: null,
        password: null,
        scope: "openid email",
        tokenType: "Bearer",
        sessionState: null,
        expiresAtMs: T0 + 3_600_000,
        extExpiresIn: null,
      });
      // Postgres stores a timestamp, the port speaks milliseconds; a Date
      // leaking through here is what breaks better-auth's expiry arithmetic.
      expect(typeof stored?.createdAtMs).toBe("number");
      expect(typeof stored?.updatedAtMs).toBe("number");
    });

    it("answers null for a row that was never written", async () => {
      expect(await repository.findById({ id: "no-such-row" })).toBeNull();
    });

    /** @scenario "A retried sign-up stores one credential, not two" */
    it("leaves the standing row alone on a retry, rather than overwriting it", async () => {
      await repository.create(newRow());
      await repository.create(newRow({ accessToken: "at_replayed" }));

      // The ceremony ahead of this is idempotent, so a retry arrives with the
      // same id. Taking the second write would let a replayed callback
      // clobber a token the user is already signed in with.
      expect(await repository.findById({ id: ROW })).toMatchObject({
        accessToken: "at_1",
      });
    });

    it("refuses a second credential for the same identifier", async () => {
      await repository.create(newRow());

      // One sign-in method, one set of secrets. Without the unique index a
      // second row would make "the credential for this identifier" ambiguous
      // and the account list would show the method twice.
      await expect(
        repository.create(newRow({ id: OTHER_ROW })),
      ).rejects.toThrow();
    });
  });

  describe("when the account list reads several identifiers at once", () => {
    it("answers only the credentials of the identifiers named", async () => {
      await repository.create(newRow());
      await repository.create(
        newRow({ id: OTHER_ROW, identifierId: OTHER_IDENTIFIER }),
      );

      const rows = await repository.findByIdentifierIds({
        identifierIds: [IDENTIFIER],
      });
      expect(rows.map((row) => row.id)).toEqual([ROW]);

      const both = await repository.findByIdentifierIds({
        identifierIds: [IDENTIFIER, OTHER_IDENTIFIER],
      });
      expect(both.map((row) => row.id).sort()).toEqual([ROW, OTHER_ROW].sort());
    });

    it("answers nothing for an empty list, rather than everything", async () => {
      await repository.create(newRow());

      expect(
        await repository.findByIdentifierIds({ identifierIds: [] }),
      ).toEqual([]);
    });
  });

  describe("when better-auth refreshes a token", () => {
    /** @scenario "A token refresh touches secrets and emits no event" */
    it("writes the named fields and leaves the unnamed ones standing", async () => {
      await repository.create(newRow());

      await repository.update({
        id: ROW,
        patch: { accessToken: "at_2", expiresAtMs: T0 + 7_200_000 },
      });

      // A refresh response routinely omits the refresh token. Treating that
      // omission as "clear it" would sign the user out at the next refresh.
      expect(await repository.findById({ id: ROW })).toMatchObject({
        accessToken: "at_2",
        refreshToken: "rt_1",
        expiresAtMs: T0 + 7_200_000,
      });
    });

    it("clears a field the patch names explicitly as null", async () => {
      await repository.create(newRow());

      await repository.update({
        id: ROW,
        patch: { refreshToken: null, expiresAtMs: null },
      });

      expect(await repository.findById({ id: ROW })).toMatchObject({
        refreshToken: null,
        expiresAtMs: null,
        accessToken: "at_1",
      });
    });

    it("writes nothing at all for an empty patch", async () => {
      await repository.create(newRow());
      const before = await repository.findById({ id: ROW });

      await repository.update({ id: ROW, patch: {} });

      expect(await repository.findById({ id: ROW })).toEqual(before);
    });

    it("does not fail when the row is gone", async () => {
      // `updateMany`, not `update`: better-auth may refresh against a row a
      // concurrent unlink already removed, and a throw there would surface
      // as a failed sign-in rather than a no-op.
      await expect(
        repository.update({ id: "no-such-row", patch: { accessToken: "x" } }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a password reset rewrites several rows", () => {
    it("patches every id named and counts them", async () => {
      await repository.create(newRow({ type: "credential" }));
      await repository.create(
        newRow({
          id: OTHER_ROW,
          identifierId: OTHER_IDENTIFIER,
          type: "credential",
        }),
      );

      expect(
        await repository.updateMany({
          ids: [ROW, OTHER_ROW],
          patch: { password: "hashed" },
        }),
      ).toBe(2);
      const rows = await repository.findByIdentifierIds({
        identifierIds: [IDENTIFIER, OTHER_IDENTIFIER],
      });
      expect(rows.every((row) => row.password === "hashed")).toBe(true);
    });

    it("touches nothing for an empty id list or an empty patch", async () => {
      await repository.create(newRow());

      expect(
        await repository.updateMany({ ids: [], patch: { password: "x" } }),
      ).toBe(0);
      expect(await repository.updateMany({ ids: [ROW], patch: {} })).toBe(0);
      expect(await repository.findById({ id: ROW })).toMatchObject({
        password: null,
      });
    });
  });

  describe("when a sign-in method is unlinked", () => {
    it("deletes the ids named, counts them, and leaves the rest", async () => {
      await repository.create(newRow());
      await repository.create(
        newRow({ id: OTHER_ROW, identifierId: OTHER_IDENTIFIER }),
      );

      expect(await repository.deleteByIds({ ids: [ROW] })).toBe(1);
      expect(await repository.findById({ id: ROW })).toBeNull();
      expect(await repository.findById({ id: OTHER_ROW })).not.toBeNull();
    });

    it("deletes nothing for an empty list", async () => {
      await repository.create(newRow());

      expect(await repository.deleteByIds({ ids: [] })).toBe(0);
      expect(await repository.findById({ id: ROW })).not.toBeNull();
    });
  });
});
