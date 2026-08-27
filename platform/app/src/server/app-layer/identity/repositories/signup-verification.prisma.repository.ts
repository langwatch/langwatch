import type { PrismaClient } from "~/generated/prisma/client";
import type {
  SignUpAccountDirectory,
  SignUpAddressState,
  SignUpVerificationTokenStore,
} from "../signup-verification.service";

/**
 * Sign-up's address-confirmation tokens, over the `VerificationToken` table.
 *
 * The table is a plain single-use token store keyed by an opaque identifier
 * string, which is exactly the shape this needs — so sign-up verification
 * costs no schema of its own. The identifier the service writes is
 * namespaced, so a token minted here can only ever be spent here.
 */
export class PrismaSignUpVerificationTokenStore
  implements SignUpVerificationTokenStore
{
  constructor(private readonly prisma: PrismaClient) {}

  async issue({
    identifier,
    token,
    expires,
  }: {
    identifier: string;
    token: string;
    expires: Date;
  }): Promise<void> {
    await this.prisma.verificationToken.create({
      data: { identifier, token, expires },
    });
  }

  /**
   * Renaming the row is the claim.
   *
   * The identifier moves into a namespace nothing can spend from, which is
   * what makes the token single-use: `readPendingSignUp` refuses the marker,
   * and a second `claim` sees it is already marked and answers null. The
   * update is CONDITIONAL on the identifier it read, so two openings racing
   * each other cannot both win — the loser's `updateMany` matches no row.
   *
   * `keepSpentUntil` rides in on `expires`, which stays true to its name: the
   * row is dead after it either way. Passing null deletes instead, for the
   * caller whose spent token must leave nothing to find.
   */
  async claim({
    token,
    now,
    keepSpentUntil,
  }: {
    token: string;
    now: Date;
    keepSpentUntil: Date | null;
  }): Promise<{ identifier: string } | null> {
    if (!keepSpentUntil) {
      const deleted = await this.prisma.verificationToken
        .delete({
          where: { token },
          select: { identifier: true, expires: true },
        })
        .catch(() => null);
      if (!deleted || deleted.expires <= now) return null;
      return liveIdentifier(deleted.identifier);
    }

    const row = await this.prisma.verificationToken.findUnique({
      where: { token },
      select: { identifier: true, expires: true },
    });
    if (!row || row.expires <= now) return null;

    const live = liveIdentifier(row.identifier);
    if (!live) return null;

    const marked = await this.prisma.verificationToken.updateMany({
      where: { token, identifier: row.identifier },
      data: {
        identifier: `${SPENT_NAMESPACE}${row.identifier}`,
        expires: keepSpentUntil,
      },
    });
    if (marked.count === 0) return null;

    return live;
  }

  async findSpent({
    token,
    now,
  }: {
    token: string;
    now: Date;
  }): Promise<{ identifier: string } | null> {
    const row = await this.prisma.verificationToken.findUnique({
      where: { token },
      select: { identifier: true, expires: true },
    });
    if (!row || row.expires <= now) return null;
    if (!row.identifier.startsWith(SPENT_NAMESPACE)) return null;
    return { identifier: row.identifier.slice(SPENT_NAMESPACE.length) };
  }
}

/**
 * The namespace a spent row is moved into. Deliberately not one any caller
 * can spend from: the marker exists to be RECOGNISED, never to be claimed.
 */
const SPENT_NAMESPACE = "identity-signup-spent:";

/** Refuses a row that has already been marked, so nothing is spent twice. */
function liveIdentifier(identifier: string): { identifier: string } | null {
  if (identifier.startsWith(SPENT_NAMESPACE)) return null;
  return { identifier };
}

/**
 * What an address already is to us. Case-insensitive for the same reason
 * `user.register` is: rows written before sign-up lowercased addresses may
 * carry capitals, and a case-twin beside one would leave two accounts
 * answering for one person.
 */
export class PrismaSignUpAccountDirectory implements SignUpAccountDirectory {
  constructor(private readonly prisma: PrismaClient) {}

  async stateFor({ email }: { email: string }): Promise<SignUpAddressState> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { emailVerified: true },
    });
    if (!user) return "unknown";
    return user.emailVerified ? "confirmed" : "awaiting_confirmation";
  }
}
