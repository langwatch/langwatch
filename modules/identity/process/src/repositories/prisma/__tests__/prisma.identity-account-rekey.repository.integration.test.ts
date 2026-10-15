/**
 * @vitest-environment node
 * @see specs/auth/azure-ad-account-upgrade.feature
 *
 * The first Microsoft sign-in after the better-auth 1.7 upgrade, against Postgres: the account
 * stored under `(local:oauth:microsoft, sub)` moves to `(iss, oid)`, its identifier follows.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { LEGACY_MICROSOFT_ISSUER } from "../../../rules/microsoft-account-key-move.rules.ts";
import { PrismaIdentityAccountRekeyRepository } from "../prisma.identity-account-rekey.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const ns = `msrekey-${nanoid(8)}`;
const USER = `${ns}-user`;
const ISSUER = "https://login.microsoftonline.com/3f2504e0-4f89-11d3-9a0c-0305e82c3301/v2.0";
const SUB = `${ns}-sub`;
const OID = `${ns}-oid`;
const MOVE = { legacySubject: SUB, issuer: ISSUER, accountId: OID };

describe.skipIf(!DB_URL)("PrismaIdentityAccountRekeyRepository", () => {
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:account-rekey"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const repository = PrismaIdentityAccountRekeyRepository.create(prisma);

  async function cleanUp() {
    await prisma.identifier.deleteMany({ where: { userId: USER } });
    await prisma.account.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  function accounts() {
    return prisma.account.findMany({
      where: { userId: USER },
      select: { id: true, provider: true, issuer: true, providerAccountId: true },
      orderBy: { id: "asc" },
    });
  }

  beforeEach(async () => {
    await cleanUp();
    await prisma.user.create({
      data: { id: USER, email: `${USER}@acme.com`, emailVerified: true },
    });
  });
  afterEach(cleanUp);
  afterAll(() => prisma.$disconnect());

  describe("when the account is still on its pre-3.17 key", () => {
    beforeEach(async () => {
      await prisma.account.createMany({
        data: [
          {
            id: `${ns}-a-microsoft`,
            userId: USER,
            provider: "microsoft",
            issuer: LEGACY_MICROSOFT_ISSUER,
            providerAccountId: SUB,
          },
          {
            id: `${ns}-b-credential`,
            userId: USER,
            provider: "credential",
            issuer: "local:credential",
            providerAccountId: USER,
          },
          {
            id: `${ns}-c-okta`,
            userId: USER,
            provider: "okta",
            issuer: "local:oauth:okta",
            providerAccountId: SUB,
          },
        ],
      });
      await prisma.identifier.create({
        data: {
          id: `${ns}-ident`,
          userId: USER,
          provider: "azure-ad",
          providerId: "microsoft",
          issuer: LEGACY_MICROSOFT_ISSUER,
          providerAccountId: SUB,
          accountId: `${ns}-a-microsoft`,
          state: "verified",
          attachedAt: new Date(),
        },
      });
    });

    /** @scenario "The first sign-in after the upgrade moves the pre-3.17 account onto the new key" */
    it("moves the account and its identifier onto the token's issuer and oid", async () => {
      await expect(repository.moveLegacyMicrosoftAccount(MOVE)).resolves.toBe("rekeyed");

      expect(await accounts()).toEqual([
        { id: `${ns}-a-microsoft`, provider: "microsoft", issuer: ISSUER, providerAccountId: OID },
        {
          id: `${ns}-b-credential`,
          provider: "credential",
          issuer: "local:credential",
          providerAccountId: USER,
        },
        {
          id: `${ns}-c-okta`,
          provider: "okta",
          issuer: "local:oauth:okta",
          providerAccountId: SUB,
        },
      ]);
      expect(
        await prisma.identifier.findUnique({
          where: { id: `${ns}-ident` },
          select: { issuer: true, providerAccountId: true },
        }),
      ).toEqual({ issuer: ISSUER, providerAccountId: OID });
    });

    /** @scenario "Signing in again after the move changes nothing" */
    it("changes nothing on the next sign-in", async () => {
      await repository.moveLegacyMicrosoftAccount(MOVE);
      const afterFirst = await accounts();

      await expect(repository.moveLegacyMicrosoftAccount(MOVE)).resolves.toBe("unchanged");

      expect(await accounts()).toEqual(afterFirst);
    });
  });

  describe("when an account is already on the new key", () => {
    /** @scenario "An account already on the new key is never overwritten by a legacy row" */
    it("leaves both the new and the legacy account as they are", async () => {
      await prisma.account.createMany({
        data: [
          {
            id: `${ns}-a-current`,
            userId: USER,
            provider: "microsoft",
            issuer: ISSUER,
            providerAccountId: OID,
          },
          {
            id: `${ns}-b-legacy`,
            userId: USER,
            provider: "microsoft",
            issuer: LEGACY_MICROSOFT_ISSUER,
            providerAccountId: SUB,
          },
        ],
      });
      const before = await accounts();

      await expect(repository.moveLegacyMicrosoftAccount(MOVE)).resolves.toBe("unchanged");

      expect(await accounts()).toEqual(before);
    });
  });
});
