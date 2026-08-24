import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaIdentityHeadsRepository } from "../identity-heads.prisma.repository";

/**
 * The guards' reads over the real `Identifier` projection: the shapes the
 * unit suites fake are proven here against Postgres — which rows count as
 * ACTIVE for the uniqueness guard, how an Account row resolves to its
 * identifier, and that a row round-trips into the fact the reducer folds.
 */
const namespace = `idheads-${nanoid(8)}`;
const USER = `${namespace}-user`;
const OTHER = `${namespace}-other`;
const repository = new PrismaIdentityHeadsRepository(prisma);

async function identifierRow(args: {
  id: string;
  userId: string;
  provider?: string;
  value?: string | null;
  state?: string;
  accountId?: string | null;
  providerAccountId?: string | null;
  attachedAt?: Date;
  detachedAt?: Date | null;
}) {
  await prisma.identifier.create({
    data: {
      id: args.id,
      userId: args.userId,
      provider: args.provider ?? "google",
      value: args.value === undefined ? `${namespace}@acme.com` : args.value,
      domain: "acme.com",
      identifierHash: null,
      accountId: args.accountId ?? null,
      providerAccountId: args.providerAccountId ?? null,
      state: args.state ?? "VERIFIED",
      connectionId: null,
      verifiedAt: new Date(1_690_000_000_000),
      attachedAt: args.attachedAt ?? new Date(1_690_000_000_000),
      detachedAt: args.detachedAt ?? null,
    },
  });
}

afterEach(async () => {
  await prisma.identifier.deleteMany({
    where: { userId: { in: [USER, OTHER] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
});

describe("PrismaIdentityHeadsRepository", () => {
  describe("when the user's rows are read as heads", () => {
    it("round-trips every column into the fact the reducer folds", async () => {
      await identifierRow({
        id: `${namespace}-idf1`,
        userId: USER,
        state: "PRIMARY",
        providerAccountId: "sub-12345",
      });

      const heads = await repository.findHeads({ userId: USER });

      expect(heads.userId).toBe(USER);
      expect(heads.identifiers[`${namespace}-idf1`]).toEqual({
        identifierId: `${namespace}-idf1`,
        userId: USER,
        provider: "google",
        value: `${namespace}@acme.com`,
        domain: "acme.com",
        identifierHash: null,
        accountId: null,
        providerAccountId: "sub-12345",
        connectionId: null,
        state: "PRIMARY",
        verifiedAtMs: 1_690_000_000_000,
        attachedAtMs: 1_690_000_000_000,
        detachedAtMs: null,
      });
    });

    it("answers empty heads for a user with no rows", async () => {
      expect(await repository.findHeads({ userId: USER })).toEqual({
        userId: USER,
        identifiers: {},
      });
    });
  });

  describe("when the uniqueness guard asks who holds a value", () => {
    it("names a VERIFIED or PRIMARY holder and ignores tombstones and pending rows", async () => {
      const value = `${namespace}-held@acme.com`;
      await identifierRow({
        id: `${namespace}-dead`,
        userId: OTHER,
        value,
        state: "DEAD_END",
      });
      await identifierRow({
        id: `${namespace}-pending`,
        userId: OTHER,
        value,
        state: "ATTACHED",
      });
      expect(
        await repository.findActiveIdentifierByValue({
          normalizedValue: value,
        }),
      ).toBeNull();

      await identifierRow({
        id: `${namespace}-live`,
        userId: USER,
        value,
        state: "VERIFIED",
      });
      expect(
        await repository.findActiveIdentifierByValue({
          normalizedValue: value,
        }),
      ).toEqual({
        userId: USER,
        identifierId: `${namespace}-live`,
      });
    });
  });

  describe("when the verification mint asks for one identifier", () => {
    it("finds it only under its own user", async () => {
      await identifierRow({
        id: `${namespace}-mine`,
        userId: USER,
        provider: "email",
        state: "ATTACHED",
      });

      expect(
        await repository.findIdentifier({
          userId: USER,
          identifierId: `${namespace}-mine`,
        }),
      ).toMatchObject({ provider: "email", state: "ATTACHED" });
      expect(
        await repository.findIdentifier({
          userId: OTHER,
          identifierId: `${namespace}-mine`,
        }),
      ).toBeNull();
    });
  });

  describe("when an Account row is resolved to the identifier it mirrors", () => {
    it("prefers the row linked by accountId", async () => {
      await identifierRow({
        id: `${namespace}-linked`,
        userId: USER,
        accountId: `${namespace}-acc`,
      });
      await identifierRow({ id: `${namespace}-same-provider`, userId: USER });

      expect(
        await repository.findIdentifierIdForAccount({
          userId: USER,
          accountId: `${namespace}-acc`,
          provider: "google",
        }),
      ).toBe(`${namespace}-linked`);
    });

    it("falls back to the single live identifier on the provider, and refuses to guess between two", async () => {
      await identifierRow({
        id: `${namespace}-only`,
        userId: USER,
        provider: "github",
      });
      expect(
        await repository.findIdentifierIdForAccount({
          userId: USER,
          accountId: `${namespace}-unlinked`,
          provider: "github",
        }),
      ).toBe(`${namespace}-only`);

      await identifierRow({
        id: `${namespace}-second`,
        userId: USER,
        provider: "github",
      });
      expect(
        await repository.findIdentifierIdForAccount({
          userId: USER,
          accountId: `${namespace}-unlinked`,
          provider: "github",
        }),
      ).toBeNull();
    });

    it("never resolves to a detached identifier", async () => {
      await identifierRow({
        id: `${namespace}-gone`,
        userId: USER,
        provider: "gitlab",
        state: "DETACHED",
        detachedAt: new Date(),
      });
      expect(
        await repository.findIdentifierIdForAccount({
          userId: USER,
          accountId: `${namespace}-unlinked`,
          provider: "gitlab",
        }),
      ).toBeNull();
    });
  });

  describe("when an IdP callback presents the provider's subject", () => {
    /** @scenario "better-auth reads an account from the identifiers" */
    it("finds the live identifier holding that subject, on that provider", async () => {
      await identifierRow({
        id: `${namespace}-sub`,
        userId: USER,
        provider: "google",
        providerAccountId: "sub-999",
      });

      expect(
        await repository.findLiveIdentifierByProviderAccount({
          provider: "google",
          providerAccountId: "sub-999",
        }),
      ).toMatchObject({
        identifierId: `${namespace}-sub`,
        userId: USER,
        providerAccountId: "sub-999",
      });

      // The subject is only unique WITHIN a provider — Google's sub-999 and
      // GitHub's sub-999 are different people, and answering across the
      // provider would sign one in as the other.
      expect(
        await repository.findLiveIdentifierByProviderAccount({
          provider: "github",
          providerAccountId: "sub-999",
        }),
      ).toBeNull();
    });

    /** @scenario "A tombstoned identifier can never sign anyone in" */
    it("answers nothing once the identifier is a tombstone", async () => {
      await identifierRow({
        id: `${namespace}-revoked`,
        userId: USER,
        provider: "github",
        providerAccountId: "sub-revoked",
        state: "DETACHED",
        detachedAt: new Date(),
      });
      await identifierRow({
        id: `${namespace}-deadend`,
        userId: OTHER,
        provider: "gitlab",
        providerAccountId: "sub-deadend",
        state: "DEAD_END",
      });

      expect(
        await repository.findLiveIdentifierByProviderAccount({
          provider: "github",
          providerAccountId: "sub-revoked",
        }),
      ).toBeNull();
      expect(
        await repository.findLiveIdentifierByProviderAccount({
          provider: "gitlab",
          providerAccountId: "sub-deadend",
        }),
      ).toBeNull();
    });

    it("answers nothing for a row that never carried a subject", async () => {
      // The column is null on every row written before ADR-116, and stays
      // null for providers that have no subject. Such a row must be
      // invisible to this lookup — including for the degenerate empty
      // subject, which SQL would otherwise be free to treat as "unset".
      await identifierRow({ id: `${namespace}-nosub`, userId: USER });

      expect(
        await repository.findLiveIdentifierByProviderAccount({
          provider: "google",
          providerAccountId: "",
        }),
      ).toBeNull();
    });
  });

  describe("when the account store reads by id, or lists a user's accounts", () => {
    it("finds one identifier by its own id, without naming a user", async () => {
      await identifierRow({ id: `${namespace}-byid`, userId: USER });

      expect(
        await repository.findIdentifierById({
          identifierId: `${namespace}-byid`,
        }),
      ).toMatchObject({ identifierId: `${namespace}-byid`, userId: USER });
      expect(
        await repository.findIdentifierById({ identifierId: "no-such-row" }),
      ).toBeNull();
    });

    it("lists the live ones oldest first, and no tombstones", async () => {
      await identifierRow({
        id: `${namespace}-second`,
        userId: USER,
        provider: "github",
        attachedAt: new Date(1_690_000_002_000),
      });
      await identifierRow({
        id: `${namespace}-first`,
        userId: USER,
        provider: "google",
        attachedAt: new Date(1_690_000_001_000),
      });
      await identifierRow({
        id: `${namespace}-tombstone`,
        userId: USER,
        provider: "gitlab",
        state: "DETACHED",
        detachedAt: new Date(),
      });
      await identifierRow({ id: `${namespace}-theirs`, userId: OTHER });

      const live = await repository.findLiveIdentifiers({ userId: USER });

      // Order is the order a person sees their linked accounts in, so it is
      // part of the contract rather than an artefact of the query plan.
      expect(live.map((identifier) => identifier.identifierId)).toEqual([
        `${namespace}-first`,
        `${namespace}-second`,
      ]);
    });
  });

  describe("when the hash key is read", () => {
    it("answers the user's key, or null before one is minted", async () => {
      await prisma.user.create({
        data: { id: USER, email: `${USER}@acme.com`, userHashKey: null },
      });
      expect(await repository.findUserHashKey({ userId: USER })).toBeNull();
      await prisma.user.update({
        where: { id: USER },
        data: { userHashKey: "key" },
      });
      expect(await repository.findUserHashKey({ userId: USER })).toBe("key");
    });
  });
});
