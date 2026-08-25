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
  providerId?: string | null;
  providerAccountId?: string | null;
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
      providerId: args.providerId ?? null,
      providerAccountId: args.providerAccountId ?? null,
      state: args.state ?? "VERIFIED",
      connectionId: null,
      verifiedAt: new Date(1_690_000_000_000),
      attachedAt: new Date(1_690_000_000_000),
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
        providerId: "auth0",
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
        providerId: "auth0",
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
        providerId: "google",
      });
      await identifierRow({
        id: `${namespace}-same-provider`,
        userId: USER,
        providerId: "google",
      });

      expect(
        await repository.findIdentifierIdForAccount({
          userId: USER,
          accountId: `${namespace}-acc`,
          providerId: "google",
        }),
      ).toBe(`${namespace}-linked`);
    });

    it("falls back to the single live identifier on the provider, and refuses to guess between two", async () => {
      await identifierRow({
        id: `${namespace}-only`,
        userId: USER,
        provider: "github",
        providerId: "github",
      });
      expect(
        await repository.findIdentifierIdForAccount({
          userId: USER,
          accountId: `${namespace}-unlinked`,
          providerId: "github",
        }),
      ).toBe(`${namespace}-only`);

      await identifierRow({
        id: `${namespace}-second`,
        userId: USER,
        provider: "github",
        providerId: "github",
      });
      expect(
        await repository.findIdentifierIdForAccount({
          userId: USER,
          accountId: `${namespace}-unlinked`,
          providerId: "github",
        }),
      ).toBeNull();
    });

    /**
     * The fallback keyed on the FOLDED vocabulary until now, and auth0 and
     * okta both fold to `oidc`. A user whose Okta identifier is missing while
     * its `Account` row survives - which the collision park can produce -
     * unlinking Okta matched their one live `oidc` identifier, the AUTH0 one,
     * and detached a sign-in they still use.
     */
    it("never detaches another enterprise IdP's identifier that folds to the same vocabulary", async () => {
      await identifierRow({
        id: `${namespace}-auth0`,
        userId: USER,
        provider: "oidc",
        providerId: "auth0",
        providerAccountId: "auth0|abc",
      });

      expect(
        await repository.findIdentifierIdForAccount({
          userId: USER,
          accountId: `${namespace}-okta-acc`,
          providerId: "okta",
        }),
      ).toBeNull();
      // And the fallback still answers for the provider it really is.
      expect(
        await repository.findIdentifierIdForAccount({
          userId: USER,
          accountId: `${namespace}-unlinked`,
          providerId: "auth0",
        }),
      ).toBe(`${namespace}-auth0`);
    });

    it("never resolves to a detached identifier", async () => {
      await identifierRow({
        id: `${namespace}-gone`,
        userId: USER,
        provider: "gitlab",
        providerId: "gitlab",
        state: "DETACHED",
        detachedAt: new Date(),
      });
      expect(
        await repository.findIdentifierIdForAccount({
          userId: USER,
          accountId: `${namespace}-unlinked`,
          providerId: "gitlab",
        }),
      ).toBeNull();
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
