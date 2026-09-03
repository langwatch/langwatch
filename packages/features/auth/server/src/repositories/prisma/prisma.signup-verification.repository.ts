import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  SignUpAccountDirectory,
  SignUpVerificationTokenStore,
} from "../../services/signup-verification.service";

/**
 * Sign-up's address-confirmation tokens, over the `VerificationToken` table.
 *
 * The table is a plain single-use token store keyed by an opaque identifier
 * string, which is exactly the shape this needs — so sign-up verification
 * costs no schema of its own. The identifier the service writes is
 * namespaced, so a token minted here can only ever be spent here.
 */
export class PrismaSignUpVerificationTokenStore implements SignUpVerificationTokenStore {
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
   * Deleting is the claim. A token that survived the delete never existed or
   * was already spent, and one that is deleted but out of date is refused all
   * the same — the row goes either way, so a spent link cannot be replayed
   * even by the racer that lost.
   */
  async claim({
    token,
    now,
  }: {
    token: string;
    now: Date;
  }): Promise<{ identifier: string } | null> {
    const claimed = await this.prisma.verificationToken
      .delete({ where: { token }, select: { identifier: true, expires: true } })
      .catch(() => null);

    if (!claimed || claimed.expires <= now) return null;
    return { identifier: claimed.identifier };
  }
}

/**
 * Whether an address already has an account. Case-insensitive for the same
 * reason `user.register` is: rows written before sign-up lowercased addresses
 * may carry capitals, and a case-twin beside one would leave two accounts
 * answering for one person.
 */
export class PrismaSignUpAccountDirectory implements SignUpAccountDirectory {
  constructor(private readonly prisma: PrismaClient) {}

  async hasAccountFor({ email }: { email: string }): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    return user !== null;
  }
}
