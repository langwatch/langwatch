import type { MemberAccountFactors, RequiringOrganization } from "@langwatch/identity-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  AccountSecondFactors,
  FederatedMemberIdentifiers,
  OrganizationMfaSetting,
  PersonContact,
  TwoStepVerificationRepository,
} from "../two-step-verification.repository.ts";

const RETIRED_CONNECTION_STATES = ["DISCARDED", "TORN_DOWN"];

export type PrismaTwoStepVerificationDatabase = Pick<
  PrismaClient,
  "user" | "passkey" | "organizationUser" | "organization" | "ssoConnection" | "identifier"
>;

/**
 * Row-truth reads over the two-factor plugin's own column, passkeys and seats (D06). The
 * requirement is an Organization column written here, as prisma.join-setting.repository.ts does.
 */
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

  async getOrganizationSetting({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationMfaSetting> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { mfaRequired: true, name: true, slug: true },
    });
    if (!organization) throw new OrganizationNotFoundError(organizationId);
    return organization;
  }

  async saveOrganizationRequirement({
    organizationId,
    mfaRequired,
  }: {
    organizationId: string;
    mfaRequired: boolean;
  }): Promise<void> {
    await this.database.organization.update({
      where: { id: organizationId },
      data: { mfaRequired },
    });
  }

  async isActiveMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const seat = await this.database.organizationUser.findFirst({
      where: { userId, organizationId, disabledAt: null },
      select: { userId: true },
    });
    return seat !== null;
  }

  /** Only identifiers the connection minted: a local sign-in says nothing about the provider. */
  async getFederatedMemberIdentifiers({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<FederatedMemberIdentifiers> {
    const connections = await this.database.ssoConnection.findMany({
      where: { organizationId, state: { notIn: RETIRED_CONNECTION_STATES } },
      select: { id: true },
    });
    if (connections.length === 0) return { connected: false, userIds: [], identifierIds: [] };
    const memberships = await this.database.organizationUser.findMany({
      where: { organizationId, disabledAt: null },
      select: { userId: true },
    });
    const userIds = memberships.map((membership) => membership.userId);
    if (userIds.length === 0) return { connected: true, userIds, identifierIds: [] };
    const identifiers = await this.database.identifier.findMany({
      where: {
        userId: { in: userIds },
        providerId: { in: connections.map((connection) => connection.id) },
      },
      select: { id: true },
    });
    return { connected: true, userIds, identifierIds: identifiers.map(({ id }) => id) };
  }

  async findPeople({ userIds }: { userIds: readonly string[] }): Promise<PersonContact[]> {
    if (userIds.length === 0) return [];
    const people = await this.database.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true, email: true },
    });
    return people.map(({ id, name, email }) => ({ userId: id, name, email }));
  }
}
