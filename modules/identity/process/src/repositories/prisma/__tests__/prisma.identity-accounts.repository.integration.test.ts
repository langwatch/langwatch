/**
 * @vitest-environment node
 * @see specs/identity/identity-storage-adapter.feature
 *
 * better-auth's account rows assembled from `Identifier` and `AccountCredential`, against Postgres.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { PrismaIdentityAccountsRepository } from "../prisma.identity-accounts.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const ns = `idaccounts-${nanoid(8)}`;
const USER = `${ns}-user`;

describe.skipIf(!DB_URL)("PrismaIdentityAccountsRepository", () => {
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:accounts"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const repository = PrismaIdentityAccountsRepository.create(prisma);

  async function cleanUp() {
    await prisma.identifier.deleteMany({ where: { userId: USER } });
    await prisma.accountCredential.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  }

  function identifier({
    suffix,
    provider,
    state,
    value = null,
    providerAccountId = null,
  }: {
    suffix: string;
    provider: string;
    state: string;
    value?: string | null;
    providerAccountId?: string | null;
  }) {
    return prisma.identifier.create({
      data: {
        id: `${ns}-i-${suffix}`,
        userId: USER,
        provider,
        providerId: provider,
        value,
        accountId: `${ns}-a-${suffix}`,
        providerAccountId,
        state,
        attachedAt: new Date(),
      },
    });
  }

  beforeEach(async () => {
    await cleanUp();
    await prisma.user.create({ data: { id: USER, email: `${USER}@acme.com` } });
  });
  afterEach(cleanUp);
  afterAll(() => prisma.$disconnect());

  describe("when a user holds a live google identifier and a detached github one", () => {
    beforeEach(async () => {
      await identifier({
        suffix: "google",
        provider: "google",
        state: "VERIFIED",
        providerAccountId: `${ns}-g`,
      });
      await identifier({
        suffix: "github",
        provider: "github",
        state: "DETACHED",
        providerAccountId: `${ns}-gh`,
      });
      await prisma.accountCredential.create({
        data: {
          id: `${ns}-a-google`,
          userId: USER,
          provider: "google",
          accessToken: "access",
        },
      });
    });

    /** @scenario "Only a live identifier assembles into an account row" */
    it("returns only the google account, carrying its credential's secrets", async () => {
      const rows = await repository.findByUser({ userId: USER });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: `${ns}-a-google`,
        providerId: "google",
        accountId: `${ns}-g`,
        accessToken: "access",
      });
      const byIds = await repository.findByAccountIds({
        accountIds: [`${ns}-a-google`, `${ns}-a-github`],
      });
      expect(byIds.map((row) => row.id)).toEqual([`${ns}-a-google`]);
    });

    /** @scenario "An account lookup by a provider subject nothing live holds is refused as not found" */
    it("refuses the detached github subject as not found", async () => {
      await expect(
        repository.getAccountByProviderSubject({
          userId: USER,
          providerId: "github",
          providerAccountId: `${ns}-gh`,
        }),
      ).rejects.toMatchObject({ code: "identity_identifier_not_found" });
    });
  });

  describe("when a live email identifier has no credential row", () => {
    /** @scenario "A live identifier without a credential row still answers, its secrets absent" */
    it("answers the account with no password and the mailbox as its account id", async () => {
      await identifier({
        suffix: "email",
        provider: "credential",
        state: "ATTACHED",
        value: `${USER}@acme.com`,
      });

      const rows = await repository.findByUser({ userId: USER });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: `${ns}-a-email`,
        accountId: `${USER}@acme.com`,
        password: null,
      });
    });
  });
});
