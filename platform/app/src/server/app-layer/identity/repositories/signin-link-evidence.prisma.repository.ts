import type { PrismaClient } from "~/generated/prisma/client";
import type {
  SignInLinkCandidate,
  SignInLinkEvidenceRepository,
} from "../signin-link-evidence";

/**
 * The two facts ADR-117 §3's evidence rule weighs about the account a
 * provider wants to attach to (ADR-129 tiering).
 *
 * Both reads go out together because neither depends on the other, and the
 * rule needs both before it can say anything: an account nobody has confirmed
 * and an account with nothing attached yet are different answers.
 */
export class PrismaSignInLinkEvidenceRepository
  implements SignInLinkEvidenceRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Answers `null` when there is no such account — nobody to link onto, which
   * the caller reads as "leave the link alone" rather than as a refusal.
   */
  async findCandidate({
    userId,
  }: {
    userId: string;
  }): Promise<SignInLinkCandidate | null> {
    const [user, attachedAccounts] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { emailVerified: true },
      }),
      this.prisma.account.count({ where: { userId } }),
    ]);
    if (!user) return null;

    return { holdsVerifiedEmail: user.emailVerified, attachedAccounts };
  }
}
