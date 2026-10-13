/**
 * @vitest-environment node
 * Adopting an unfinished account against a real Postgres: one transaction, memberships kept.
 * @see modules/user/specs/user.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaUserRepository } from "../prisma.user.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `adopt-${randomUUID()}`;

describe.skipIf(!databaseUrl)("given accounts on addresses nobody has proven yet", () => {
  let connection: PrismaConnection;
  let organizationId: string;

  /** An account holding a password, a second linked method and a passkey. */
  async function seedAccount({
    label,
    emailVerified,
    signedIn,
  }: {
    label: string;
    emailVerified: boolean;
    signedIn: boolean;
  }): Promise<string> {
    const client = connection.client;
    const { id } = await client.user.create({
      data: {
        email: `${label}@${RUN}.test`,
        emailVerified,
        signupConfirmationPending: !emailVerified,
        passkeySignupClaimHash: emailVerified ? null : "claim-hash",
        lastLoginAt: signedIn ? new Date() : null,
      },
    });
    await client.account.createMany({
      data: [
        { userId: id, provider: "credential", providerAccountId: id, password: "pre-proof-hash" },
        { userId: id, provider: "github", providerAccountId: `${RUN}-${label}` },
      ],
    });
    await client.passkey.create({
      data: { userId: id, publicKey: "key", credentialID: `${RUN}-${label}`, deviceType: "x" },
    });
    await client.organizationUser.create({ data: { userId: id, organizationId, role: "MEMBER" } });

    return id;
  }

  async function standing(userId: string) {
    const client = connection.client;
    const [user, accounts, passkeys, memberships] = await Promise.all([
      client.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          emailVerified: true,
          signupConfirmationPending: true,
          passkeySignupClaimHash: true,
        },
      }),
      client.account.count({ where: { userId } }),
      client.passkey.count({ where: { userId } }),
      client.organizationUser.count({ where: { userId, organizationId } }),
    ]);

    return { ...user, accounts, passkeys, memberships };
  }

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:user-adoption:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    organizationId = (
      await connection.client.organization.create({ data: { name: RUN, slug: RUN } })
    ).id;
  });

  afterAll(async () => {
    const client = connection.client;
    await client.organizationUser.deleteMany({ where: { organizationId } });
    await client.user.deleteMany({ where: { email: { contains: RUN } } });
    await client.organization.deleteMany({ where: { id: organizationId } });
    await client.$disconnect();
  });

  describe("when an address proof adopts one awaiting confirmation that was never signed into", () => {
    /** @scenario "Adopting an unfinished account confirms it and drops its pre-proof sign-in methods at once" */
    it("confirms it, drops every sign-in method and passkey, and keeps its membership", async () => {
      const users = PrismaUserRepository.create({ prisma: connection.client });
      const userId = await seedAccount({
        label: "unfinished",
        emailVerified: false,
        signedIn: false,
      });

      await expect(users.adoptUnconfirmed({ id: userId })).resolves.toBe("adopted");

      await expect(standing(userId)).resolves.toEqual({
        emailVerified: true,
        signupConfirmationPending: false,
        passkeySignupClaimHash: null,
        accounts: 0,
        passkeys: 0,
        memberships: 1,
      });
    });
  });

  describe("when the account is confirmed, or has been signed into", () => {
    /** @scenario "Adoption refuses an account that is confirmed or has been signed into" */
    it("names why and changes nothing", async () => {
      const users = PrismaUserRepository.create({ prisma: connection.client });
      const confirmed = await seedAccount({
        label: "confirmed",
        emailVerified: true,
        signedIn: false,
      });
      const used = await seedAccount({ label: "used", emailVerified: false, signedIn: true });
      const before = { confirmed: await standing(confirmed), used: await standing(used) };

      await expect(users.adoptUnconfirmed({ id: confirmed })).resolves.toBe("already_confirmed");
      await expect(users.adoptUnconfirmed({ id: used })).resolves.toBe("signed_in");

      await expect(standing(confirmed)).resolves.toEqual(before.confirmed);
      await expect(standing(used)).resolves.toEqual(before.used);
    });
  });

  describe("when the account does not exist", () => {
    it("answers no_account", async () => {
      const users = PrismaUserRepository.create({ prisma: connection.client });

      await expect(users.adoptUnconfirmed({ id: `${RUN}-nobody` })).resolves.toBe("no_account");
    });
  });
});
