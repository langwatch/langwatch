import { issuerForProviderId } from "@langwatch/identity-server/better-auth";
import type { PrismaClient } from "~/generated/prisma/client";
import { trackServerEvent } from "~/server/posthog";

/**
 * A passkey sign-up that arrived for an address somebody already holds.
 *
 * Its own class because the caller has to tell it apart from every other way
 * this can fail: it is the one that means "refuse in the taken-address
 * vocabulary", and a message match would be the alternative.
 */
export class PasskeySignUpAddressTakenError extends Error {
  readonly name = "PasskeySignUpAddressTakenError";
}

/**
 * A credential row somebody could actually present.
 *
 * `provider` decides it rather than `password`: a row for an identity
 * provider carries no password by design and is still a way in, while a
 * `credential` row with no password is the one shape that is not — it is what
 * `createPasskeyUser` writes before the passkey lands beside it, and on its
 * own it authenticates nobody (sign-in hashes a dummy and refuses it exactly
 * as it refuses a missing row).
 *
 * Empty counts as absent, in the same words `last-way-in.ts` uses. The two
 * guards answer one question from opposite sides — that one refuses removing
 * the last way in, this one refuses adopting an account that still has one —
 * so a row either calls a credential the other must too.
 */
export function isUsableCredential(row: {
  provider: string;
  password: string | null;
}): boolean {
  if (row.provider !== "credential") return true;
  return typeof row.password === "string" && row.password.length > 0;
}

/**
 * Whether this account is somebody's, rather than the residue of a ceremony
 * that never finished.
 *
 * ONE definition, exported, because two collaborators decide the same thing
 * about the same row at two moments: the sign-up guard refuses before the
 * browser prompt opens, and the adoption re-decides it inside the transaction
 * that writes. Two copies of this would be two chances to disagree, and the
 * disagreement would be a takeover on one side or a burnt address on the
 * other.
 *
 * Both credential tables are read: a user whose identifier backfill has
 * finalized keeps theirs in `AccountCredential` rather than `Account`, and a
 * check seeing only one would call every finalized user unregistered.
 * Membership counts on its own — an account that belongs to an organization
 * is somebody's whatever its credential rows say.
 */
export function belongsToSomebody(row: {
  accounts: { provider: string; password: string | null }[];
  accountCredentials: { provider: string; password: string | null }[];
  passkeys: unknown[];
  orgMemberships: unknown[];
}): boolean {
  return (
    row.passkeys.length > 0 ||
    row.orgMemberships.length > 0 ||
    row.accounts.some(isUsableCredential) ||
    row.accountCredentials.some(isUsableCredential)
  );
}

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
    // address must not both conclude the row is theirs to make. For the
    // CREATE branch the unique index on the address settles that race anyway
    // — the loser fails rather than writing a twin. For the ADOPT branch it
    // cannot, because adopting touches no unique column, which is why the
    // decision is re-taken below rather than inherited from the caller.
    const existing = await tx.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        accounts: { select: { id: true, provider: true, password: true } },
        accountCredentials: { select: { provider: true, password: true } },
        passkeys: { select: { id: true }, take: 1 },
        orgMemberships: { select: { organizationId: true }, take: 1 },
      },
    });

    if (existing) {
      // Asked AGAIN, here, rather than trusted from the caller. The caller's
      // refusal ran before this transaction opened, and between the two an
      // account that was residue can become somebody's — a password set, a
      // passkey landed, an invitation redeemed. Deciding it inside the
      // transaction that adopts is what makes the read and the write one
      // decision instead of two; before, the unique index on the address was
      // the backstop for that race, and adopting rather than creating is
      // exactly what takes the index out of the path.
      if (belongsToSomebody(existing)) {
        throw new PasskeySignUpAddressTakenError(
          "the address gained a credential between the guard and the adoption",
        );
      }

      // All that can be missing is the placeholder itself, if the earlier
      // attempt died between its two writes.
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
