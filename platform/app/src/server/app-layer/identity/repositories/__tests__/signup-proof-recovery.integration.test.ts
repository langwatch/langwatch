import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { SignUpVerificationService } from "../../signup-verification.service";
import { PrismaCredentialAccountRepository } from "../credential-account.prisma.repository";
import {
  PrismaSignUpAccountDirectory,
  PrismaSignUpVerificationTokenStore,
} from "../signup-verification.prisma.repository";

describe("sign-up proof recovery after enrollment failure", () => {
  const namespace = nanoid(8).toLowerCase();
  const email = `signup-proof-recovery-${namespace}@example.com`;
  const issuedTokens: string[] = [];
  const sentLinks: string[] = [];
  const now = new Date("2026-09-07T08:00:00.000Z");
  const tokens = new PrismaSignUpVerificationTokenStore(prisma);
  const verification = new SignUpVerificationService({
    tokens,
    directory: new PrismaSignUpAccountDirectory(prisma),
    mailer: {
      sendVerificationLink: async ({ verificationUrl }) => {
        sentLinks.push(verificationUrl);
      },
    },
    buildVerificationUrl: ({ token }) =>
      `http://localhost:3000/sign-up/confirm?token=${token}`,
    now: () => now,
    mintToken: () => {
      const token = `signup-proof-recovery-${namespace}-${issuedTokens.length}`;
      issuedTokens.push(token);
      return token;
    },
  });
  const credentials = new PrismaCredentialAccountRepository(prisma);

  afterAll(async () => {
    await prisma.verificationToken.deleteMany({
      where: { token: { in: issuedTokens } },
    });
    await cleanupTestRows(prisma, [["user", { email }]]);
  });

  /** @scenario A claimed proof whose enrollment failed recovers by email */
  it("requires fresh mailbox proof after enrollment fails", async () => {
    await verification.requestVerification({ email });
    const firstLinkToken = tokenFromLastMail();
    const firstConfirmation = await verification.completeVerification({
      token: firstLinkToken,
    });
    const firstAddressProof = firstConfirmation.addressProof;

    expect(firstAddressProof).not.toBeNull();
    if (!firstAddressProof) {
      throw new Error("the first link minted no proof");
    }
    expect(
      await verification.claimAddressProof({
        token: firstAddressProof,
        email: `other-${email}`,
      }),
    ).toBe(false);
    expect(
      await verification.claimAddressProof({
        token: firstAddressProof,
        email,
      }),
    ).toBe(true);

    await expect(
      credentials.createCredentialUser({
        name: "invalid\u0000postgres-text",
        email,
        passwordHash: "first-password-hash",
      }),
    ).rejects.toThrow();

    expect(await accountState()).toEqual({
      users: 0,
      credentials: 0,
      sessions: 0,
    });
    expect(
      await verification.claimAddressProof({
        token: firstAddressProof,
        email,
      }),
    ).toBe(false);

    const reopened = await verification.completeVerification({
      token: firstLinkToken,
    });
    expect(reopened).toMatchObject({
      email,
      accountCreated: false,
      accountExists: false,
      addressProof: null,
    });

    await verification.requestVerification({ email });
    const freshLinkToken = tokenFromLastMail();
    expect(freshLinkToken).not.toBe(firstLinkToken);
    const freshConfirmation = await verification.completeVerification({
      token: freshLinkToken,
    });
    const freshAddressProof = freshConfirmation.addressProof;

    expect(freshAddressProof).not.toBeNull();
    if (!freshAddressProof) {
      throw new Error("the fresh link minted no proof");
    }
    expect(
      await verification.claimAddressProof({
        token: freshAddressProof,
        email,
      }),
    ).toBe(true);

    await credentials.createCredentialUser({
      name: email,
      email,
      passwordHash: "recovery-password-hash",
    });

    const recovered = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: {
        emailVerified: true,
        signupConfirmationPending: true,
        accounts: {
          select: { provider: true, password: true },
        },
        sessions: { select: { id: true } },
      },
    });
    expect(recovered).toEqual({
      emailVerified: true,
      signupConfirmationPending: false,
      accounts: [
        { provider: "credential", password: "recovery-password-hash" },
      ],
      sessions: [],
    });
  });

  function tokenFromLastMail(): string {
    const link = sentLinks.at(-1);
    if (!link) {
      throw new Error("the verification mail was not sent");
    }
    const token = new URL(link).searchParams.get("token");
    if (!token) {
      throw new Error("the verification mail had no token");
    }
    return token;
  }

  async function accountState(): Promise<{
    users: number;
    credentials: number;
    sessions: number;
  }> {
    const users = await prisma.user.findMany({
      where: { email },
      select: { id: true },
    });
    const userIds = users.map(({ id }) => id);
    const [credentials, sessions] = await Promise.all([
      prisma.account.count({ where: { userId: { in: userIds } } }),
      prisma.session.count({ where: { userId: { in: userIds } } }),
    ]);
    return { users: users.length, credentials, sessions };
  }
});
