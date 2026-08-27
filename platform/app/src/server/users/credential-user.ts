import { issuerForProviderId } from "@langwatch/identity-server/better-auth";
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
        // better-auth 1.7 looks a credential row up by `(issuer, accountId)`.
        // A row written without the issuer is a row it cannot see, so the
        // account created here would be told its own password is wrong.
        issuer: issuerForProviderId("credential"),
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

/**
 * Creating an account whose credential is a passkey.
 *
 * The passkey row is written by the plugin, against the id this returns, so
 * there is no password to take and nothing here writes one.
 *
 * The credential Account row is still created, holding a NULL password, and
 * that is the whole point of it. Password reset updates credential rows in
 * place (`updateMany` on `provider: "credential"`), so an account with no such
 * row cannot be recovered by resetting a password — the update matches nothing
 * and reports success, which is a reset that silently does nothing and a
 * person locked out of their own account with no error to show for it. A row
 * with a null password is refused by sign-in exactly as a missing one is
 * (BetterAuth hashes a dummy and answers "invalid email or password", so the
 * timing does not differ either), and it gives recovery something to land on.
 *
 * ## Why this RESUMES rather than always creating
 *
 * Because the ceremony it serves cannot be made atomic, and pretending
 * otherwise is what stranded addresses. The passkey plugin calls
 * `resolveUser` before the browser prompt and `afterVerification` after it —
 * two requests, a round trip apart — and this runs inside the second. Its own
 * `$transaction` commits independently of whatever happens next: if the
 * passkey write or the session mint then fails, the rows written here are
 * already durable and nothing can take them back.
 *
 * The recovery for a write that cannot be rolled back is one that can be
 * repeated. So a User row for this address with no usable credential is the
 * unfinished attempt, and it is ADOPTED — same row, same id, the placeholder
 * account left where it is — rather than colliding with the unique index on
 * the address and turning a resumable state into a permanent one.
 *
 * `signed_up` is emitted only for a row this call actually created, so a
 * person who needed two attempts is one sign-up, not two.
 */
export async function createPasskeyUser({
  prisma,
  email,
}: {
  prisma: PrismaClient;
  email: string;
}): Promise<{ id: string; created: boolean }> {
  const outcome = await prisma.$transaction(async (tx) => {
    // Inside the transaction on purpose: the read and the write that depends
    // on it are one decision, and two concurrent ceremonies for the same
    // address must not both conclude the row is theirs to make. The unique
    // index on the address is still the backstop — the loser of that race
    // fails here rather than writing a twin.
    const existing = await tx.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        accounts: { select: { id: true, provider: true } },
      },
    });

    if (existing) {
      // The caller has already established this account holds no credential
      // anybody could present; all that can be missing is the placeholder
      // itself, if the earlier attempt died between the two writes.
      const hasPlaceholder = existing.accounts.some(
        (account) => account.provider === "credential",
      );
      if (!hasPlaceholder) {
        await tx.account.create({
          data: {
            userId: existing.id,
            type: "credential",
            provider: "credential",
            issuer: issuerForProviderId("credential"),
            providerAccountId: existing.id,
            password: null,
          },
        });
      }
      return { id: existing.id, created: false };
    }

    const user = await tx.user.create({ data: { name: null, email } });
    await tx.account.create({
      data: {
        userId: user.id,
        type: "credential",
        provider: "credential",
        issuer: issuerForProviderId("credential"),
        providerAccountId: user.id,
        password: null,
      },
    });
    return { id: user.id, created: true };
  });

  if (outcome.created) {
    trackServerEvent({ userId: outcome.id, event: "signed_up" });
  }

  return outcome;
}
