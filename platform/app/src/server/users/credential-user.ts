import type { PrismaClient } from "~/generated/prisma/client";
import { trackServerEvent } from "~/server/posthog";

/**
 * Creating an account that authenticates with a password.
 *
 * One writer for both doors into it: the sign-up form, and a verified sign-up
 * that started as a log-in with an address nobody held (D13). They must write
 * the same two rows in the same transaction, or one of them produces a User
 * with no way to sign in.
 *
 * Takes a HASH rather than a password: the log-in door hashes at the moment
 * the credential is taken and keeps only the hash until the address is
 * verified, so there is never a plaintext password at rest anywhere.
 */
export async function createCredentialUser({
  prisma,
  name,
  email,
  passwordHash,
}: {
  prisma: PrismaClient;
  /** Null when nobody has been asked for one yet; onboarding asks later. */
  name: string | null;
  email: string;
  passwordHash: string;
}): Promise<{ id: string }> {
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name, email } });
    await tx.account.create({
      data: {
        userId: user.id,
        type: "credential",
        provider: "credential",
        providerAccountId: user.id,
        password: passwordHash,
      },
    });
    return user;
  });

  // Email-mode signups bypass the BetterAuth user-create hooks, so the
  // `signed_up` analytics event fires here instead.
  trackServerEvent({ userId: created.id, event: "signed_up" });

  return { id: created.id };
}
