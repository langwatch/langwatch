import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { PrismaCredentialAccountRepository } from "../credential-account.prisma.repository";

const hashClaim = (claim: string): string =>
  createHash("sha256").update(claim).digest("base64url");

describe("passkey sign-up claim concurrency", () => {
  const namespace = nanoid(8);
  const email = `passkey-claim-${namespace}@example.com`;
  const repository = new PrismaCredentialAccountRepository(prisma);

  afterAll(async () => {
    await cleanupTestRows(prisma, [["user", { email }]]);
  });

  /** @scenario Concurrent browsers cannot both claim one free address */
  it("allows exactly one distinct browser claim to create the verified account", async () => {
    const claims = [hashClaim("browser-a"), hashClaim("browser-b")];

    const attempts = await Promise.allSettled(
      claims.map((claimHash) =>
        repository.createPasskeyUser({ email, claimHash }),
      ),
    );

    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
    const users = await prisma.user.findMany({
      where: { email },
      select: {
        emailVerified: true,
        signupConfirmationPending: true,
        passkeySignupClaimHash: true,
      },
    });
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      emailVerified: true,
      signupConfirmationPending: false,
    });
    expect(claims).toContain(users[0]?.passkeySignupClaimHash);
  });
});
