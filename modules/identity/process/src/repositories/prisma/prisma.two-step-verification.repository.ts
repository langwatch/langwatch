import type { MemberAccountFactors, RequiringOrganization } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  AccountSecondFactors,
  TwoStepVerificationRepository,
} from "../two-step-verification.repository.ts";

export type PrismaTwoStepVerificationDatabase = Pick<
  PrismaClient,
  "user" | "passkey" | "organizationUser"
>;

/** Row-truth reads over the two-factor plugin's own column, passkeys and seats (D06). */
export class PrismaTwoStepVerificationRepository implements TwoStepVerificationRepository {
  static create(database: PrismaTwoStepVerificationDatabase): PrismaTwoStepVerificationRepository {
    return new PrismaTwoStepVerificationRepository(database);
  }

  private constructor(private readonly database: PrismaTwoStepVerificationDatabase) {}

  async getAccountFactors({ userId }: { userId: string }): Promise<AccountSecondFactors> {
    const [user, passkeyCount] = await Promise.all([
      this.database.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }),
      this.database.passkey.count({ where: { userId } }),
    ]);
    return { accountEnrollmentEnabled: user?.twoFactorEnabled ?? false, passkeyCount };
  }

  /** A nested select, as the disable guard reads it: no top-level organization query (ADR-021). */
  async findRequiringOrganizations({
    userId,
  }: {
    userId: string;
  }): Promise<RequiringOrganization[]> {
    const person = await this.database.user.findUnique({
      where: { id: userId },
      select: {
        orgMemberships: {
          where: { disabledAt: null, organization: { mfaRequired: true } },
          select: { organization: { select: { id: true, name: true, slug: true } } },
        },
      },
    });
    return (person?.orgMemberships ?? []).map(({ organization }) => ({
      organizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
    }));
  }

  async findMemberAccountFactors({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<MemberAccountFactors[]> {
    const memberships = await this.database.organizationUser.findMany({
      where: { organizationId, disabledAt: null },
      select: {
        userId: true,
        user: { select: { name: true, email: true, twoFactorEnabled: true } },
      },
    });
    const userIds = memberships.map((membership) => membership.userId);
    // A groupBy rather than a `_count` include, which Prisma plans as a per-row join.
    const passkeys =
      userIds.length === 0
        ? []
        : await this.database.passkey.groupBy({
            by: ["userId"],
            where: { userId: { in: userIds } },
            _count: { _all: true },
          });
    const passkeysByUser = new Map(passkeys.map((row) => [row.userId, row._count._all]));
    return memberships.map((membership) => ({
      userId: membership.userId,
      name: membership.user.name,
      email: membership.user.email,
      accountEnrollmentEnabled: membership.user.twoFactorEnabled,
      passkeyCount: passkeysByUser.get(membership.userId) ?? 0,
    }));
  }
}
