import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import type {
  OrganizationConnectionFactorPort,
  OrganizationMemberFactorPort,
  OrganizationMfaNotifier,
  OrganizationMfaSettingPort,
  SessionFactorPort,
} from "./organization-mfa.service";

const logger = createLogger("langwatch:identity:organization-mfa");

/**
 * The reads and the one write behind the organization's membership condition
 * (D06). Prisma lives here so the service stays a decision.
 *
 * Every source is ROW-TRUTH on purpose. The shared secret and the backup
 * codes are the two-factor plugin's own, in its own table; whether a person
 * finished a setup is `User.twoFactorEnabled`, which the plugin sets and
 * which the impersonation guard already reads, so there is exactly one answer
 * to "has this person got one" across the product.
 */
export class PrismaOrganizationMfaSettings
  implements OrganizationMfaSettingPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async read({ organizationId }: { organizationId: string }): Promise<{
    mfaRequired: boolean;
    name: string;
    slug: string;
  }> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { mfaRequired: true, name: true, slug: true },
    });
    // A plain Error: nothing the caller can do about an organization that is
    // not there, and the gate must never invent a refusal it can name.
    if (!organization) {
      throw new Error(
        `organization ${organizationId} was not found while reading its two-step verification requirement`,
      );
    }
    return organization;
  }

  async write({
    organizationId,
    mfaRequired,
  }: {
    organizationId: string;
    mfaRequired: boolean;
  }): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { mfaRequired },
    });
  }
}

/** Who holds a seat, and what their account carries. */
export class PrismaOrganizationMemberFactors
  implements OrganizationMemberFactorPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async membersOf({ organizationId }: { organizationId: string }): Promise<
    readonly {
      userId: string;
      name: string | null;
      email: string | null;
      accountEnrollmentEnabled: boolean;
      passkeyCount: number;
    }[]
  > {
    const memberships = await this.prisma.organizationUser.findMany({
      // A disabled seat is not a member (the RBAC rule), so a person whose
      // seat is off is not held at a gate for an organization they cannot
      // reach anyway.
      where: { organizationId, disabledAt: null },
      select: {
        userId: true,
        user: {
          select: { id: true, name: true, email: true, twoFactorEnabled: true },
        },
      },
    });
    const userIds = memberships.map((membership) => membership.userId);
    // A second groupBy rather than a `_count` relation include: Prisma builds
    // that as an uncorrelated join the planner may re-run per listed row.
    const passkeys =
      userIds.length === 0
        ? []
        : await this.prisma.passkey.groupBy({
            by: ["userId"],
            where: { userId: { in: userIds } },
            _count: { _all: true },
          });
    const passkeysByUser = new Map(
      passkeys.map((row) => [row.userId, row._count._all]),
    );
    return memberships.map((membership) => ({
      userId: membership.userId,
      name: membership.user.name,
      email: membership.user.email,
      accountEnrollmentEnabled: membership.user.twoFactorEnabled,
      passkeyCount: passkeysByUser.get(membership.userId) ?? 0,
    }));
  }

  async accountFactorFor({ userId }: { userId: string }): Promise<{
    accountEnrollmentEnabled: boolean;
    passkeyCount: number;
  }> {
    const [user, passkeyCount] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorEnabled: true },
      }),
      this.prisma.passkey.count({ where: { userId } }),
    ]);
    return {
      accountEnrollmentEnabled: user?.twoFactorEnabled ?? false,
      passkeyCount,
    };
  }

  async isMember({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { userId, organizationId, disabledAt: null },
      select: { userId: true },
    });
    return membership !== null;
  }
}

/**
 * What this organization's identity provider is asserting, read off the
 * sessions it actually minted.
 *
 * There is no column on a connection saying "I assert a second factor",
 * because a connection cannot be asked — an identity provider says what it
 * says on each assertion, and it says it in `amr`. So the answer is
 * observational: the factors this organization's members' live sessions
 * recorded. That is also the only honest answer, since a connection
 * reconfigured at the provider this morning starts asserting this morning,
 * with nothing on our side to update.
 *
 * `null` means the organization has no connection at all, and it is a
 * different answer from `[]` — a connection asserting nothing is a thing the
 * administrator has to be told about, and no connection is not.
 */
export class PrismaOrganizationConnectionFactors
  implements OrganizationConnectionFactorPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async assertedFactorsFor({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<readonly string[] | null> {
    const connection = await this.prisma.ssoConnection.findFirst({
      where: { organizationId },
      select: { id: true },
    });
    if (!connection) return null;

    const memberships = await this.prisma.organizationUser.findMany({
      where: { organizationId, disabledAt: null },
      select: { userId: true },
    });
    if (memberships.length === 0) return [];

    const sessions = await this.prisma.session.findMany({
      where: {
        userId: { in: memberships.map((membership) => membership.userId) },
        expires: { gt: new Date() },
      },
      select: { amr: true },
    });
    const asserted = new Set<string>();
    for (const session of sessions) {
      for (const value of session.amr) asserted.add(value);
    }
    return [...asserted];
  }
}

/**
 * What one session recorded it proved, read off the row it was minted into.
 *
 * A missing row answers `null` rather than throwing: a session the store no
 * longer has is not a session that failed a check, and the request that asked
 * has its own reasons for being here. Nothing on this class writes.
 */
export class PrismaSessionFactors implements SessionFactorPort {
  constructor(private readonly prisma: PrismaClient) {}

  async amrFor({
    sessionId,
  }: {
    sessionId: string;
  }): Promise<readonly string[] | null> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { amr: true },
    });
    if (!session) return null;
    // Empty is the honest answer for every session minted before the column,
    // and `satisfiesOrganizationMfaRequirement` reads it as proving nothing.
    return session.amr;
  }
}

/**
 * Telling an organization's members that the requirement now applies.
 *
 * Logged rather than mailed for now, deliberately and visibly: the members
 * area already tells a held person what to do at the gate itself, which is
 * where they will be standing, and a mail nobody wrote copy for is worse than
 * no mail. The port exists so the mail can be added without the service
 * changing shape.
 */
export class LoggingOrganizationMfaNotifier implements OrganizationMfaNotifier {
  async requirementTurnedOn({
    organizationId,
    actorUserId,
    memberUserIds,
  }: {
    organizationId: string;
    actorUserId: string;
    memberUserIds: readonly string[];
  }): Promise<void> {
    logger.info(
      { organizationId, actorUserId, memberCount: memberUserIds.length },
      "organization now requires a second factor; its members were told",
    );
  }
}
