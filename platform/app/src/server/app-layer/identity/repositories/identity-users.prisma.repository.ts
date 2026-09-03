import type { IdentityUsersRepository } from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";

/** One `User` row, as the sign-in and account-linking decisions read it. */
export interface IdentityUserRow {
  id: string;
  email: string | null;
  name: string | null;
  deactivatedAt: Date | null;
  pendingSsoSetup: boolean;
}

/**
 * The `User` columns identity touches — the two the ceremonies write, and the
 * handful the sign-in boundary reads about a person it already has an id for.
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

  /**
   * One person by id, for the hooks that already hold one.
   *
   * A single shape rather than a select per caller: four hooks read this row
   * about the same person on the same request, and four different selects of
   * five small columns bought nothing but four places to keep in step.
   */
  async findById({
    userId,
  }: {
    userId: string;
  }): Promise<IdentityUserRow | null> {
    return await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        deactivatedAt: true,
        pendingSsoSetup: true,
      },
    });
  }

  /** The soft-block banner's flag (ADR-027): set when somebody signs in with
   *  a provider their organization's SSO does not name. */
  async updatePendingSsoSetup({
    userId,
    pendingSsoSetup,
  }: {
    userId: string;
    pendingSsoSetup: boolean;
  }): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pendingSsoSetup },
    });
  }

  async updateLastLoginAt({
    userId,
    lastLoginAt,
  }: {
    userId: string;
    lastLoginAt: Date;
  }): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt },
    });
  }

  /**
   * How many organizations this person belongs to.
   *
   * Counted through `User._count.orgMemberships` rather than over
   * `OrganizationUser` directly, because the multitenancy middleware refuses
   * an `OrganizationUser` query that names no organization — and this
   * question names no organization by definition.
   */
  async countOrganizationMemberships({
    userId,
  }: {
    userId: string;
  }): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { _count: { select: { orgMemberships: true } } },
    });
    return user?._count.orgMemberships ?? 0;
  }
}
