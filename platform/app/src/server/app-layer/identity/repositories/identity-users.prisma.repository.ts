import type { IdentityUsersRepository } from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The two `User` columns identity touches.
 *
 * The `userHashKey` write is guarded (ADR-101 §4): only a user without a key
 * takes one, so a key minted concurrently — by the ceremony at user
 * creation, by another backfill pass — is never overwritten. Rewriting it
 * would orphan every identifier hash already computed with the old key.
 *
 * `User` is an identity table under the multitenancy middleware's
 * Identifier/Account exemption, so these queries carry no `projectId` — the
 * model has none, and a user is not scoped to a project.
 */
export class PrismaIdentityUsersRepository implements IdentityUsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async storeUserHashKeyIfMissing({
    userId,
    userHashKey,
  }: {
    userId: string;
    userHashKey: string;
  }): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, userHashKey: null },
      data: { userHashKey },
    });
  }

  async findEmail({ userId }: { userId: string }): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  /**
   * The legacy half of the cross-population collision guard (ADR-116 §6).
   *
   * Case-insensitive equality on the column as stored, which is the same
   * comparison `User.email @unique` effectively defends — so this refuses,
   * by name, exactly the collisions that would otherwise have surfaced as a
   * constraint violation inside the fold. The port's docstring names the
   * blind spot it inherits (a plus-addressed legacy row).
   *
   * Deactivated users still count as holders: their row keeps the address
   * and the unique index keeps enforcing it, so calling it free here would
   * hand the customer a refusal from Postgres one step later.
   */
  async findUserIdByEmail({
    normalizedValue,
  }: {
    normalizedValue: string;
  }): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: normalizedValue, mode: "insensitive" } },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /**
   * Who holds an address, and everything they could sign into it with.
   *
   * The wider read behind the passkey sign-up guard, which has to tell an
   * account apart from the residue of a ceremony that never finished. Both
   * credential tables are selected, because a user whose backfill has
   * finalized keeps theirs in `AccountCredential` rather than `Account`; one
   * passkey and one membership are enough, because the question is only
   * whether any exists.
   *
   * Case-insensitive for the same reason `findUserIdByEmail` is: rows written
   * before addresses were stored lowercased may carry capitals, and a
   * case-twin beside one is two Users answering for one person.
   */
  async findAddressHolder({ email }: { email: string }): Promise<{
    id: string;
    accounts: { provider: string; password: string | null }[];
    accountCredentials: { provider: string; password: string | null }[];
    passkeys: { id: string }[];
    orgMemberships: { organizationId: string }[];
  } | null> {
    return await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        accounts: { select: { provider: true, password: true } },
        accountCredentials: { select: { provider: true, password: true } },
        passkeys: { select: { id: true }, take: 1 },
        orgMemberships: { select: { organizationId: true }, take: 1 },
      },
    });
  }
}
