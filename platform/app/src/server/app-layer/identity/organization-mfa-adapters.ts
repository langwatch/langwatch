import { normalizeIdentifierValue } from "@langwatch/identity";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { sendOrganizationMfaRequirementEmail } from "~/server/mailer/organization-mfa-requirement-email";
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
    // A DISCARDED or TORN_DOWN connection is not a connection this
    // organization has. Counting one meant an abandoned setup left the
    // members page warning forever that "your identity provider is not
    // telling us a second factor was used" about a provider that does not
    // exist.
    const connections = await this.prisma.ssoConnection.findMany({
      where: {
        organizationId,
        state: { notIn: ["DISCARDED", "TORN_DOWN"] },
      },
      select: { id: true },
    });
    if (connections.length === 0) return null;

    const memberships = await this.prisma.organizationUser.findMany({
      where: { organizationId, disabledAt: null },
      select: { userId: true },
    });
    if (memberships.length === 0) return [];

    // ONLY THE SESSIONS THE CONNECTION MINTED. The question this answers is
    // what the IDENTITY PROVIDER asserts, and reading it off every member
    // session answered a different one: one member signing in locally with a
    // password and an authenticator code put `otp` in the set, so the screen
    // told an administrator their provider covers the second factor and
    // suppressed the warning — while every federated member kept being held
    // at the enrollment gate for the reason it had just hidden.
    //
    // `Identifier.providerId` is the connection the session was minted
    // through (ADR-116), which is what ties a session to the provider rather
    // than to the person. Read in two steps because `Session.identifierId`
    // carries no relation field — it is a plain column, on purpose, so that
    // adding it ended nobody's session.
    const memberIds = memberships.map((membership) => membership.userId);
    const federatedIdentifiers = await this.prisma.identifier.findMany({
      where: {
        userId: { in: memberIds },
        providerId: { in: connections.map((connection) => connection.id) },
      },
      select: { id: true },
    });
    if (federatedIdentifiers.length === 0) return [];

    const sessions = await this.prisma.session.findMany({
      where: {
        userId: { in: memberIds },
        expires: { gt: new Date() },
        identifierId: {
          in: federatedIdentifiers.map((identifier) => identifier.id),
        },
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
 * Telling an organization's active members when its requirement changes.
 * Delivery uses the same mail transport as the rest of the app. Every
 * recipient is attempted before a failure is reported, and the log names the
 * failed count rather than claiming the whole audience was reached. Identity
 * owns the destination once a user is latched. The injected resolver owns the
 * latch-aware legacy fallback so a missing canonical address can never revive
 * a detached mailbox here.
 */
export class EmailOrganizationMfaNotifier implements OrganizationMfaNotifier {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly resolveDeliveryEmail: (args: {
      userId: string;
      legacyEmail: string | null;
    }) => Promise<string | null>,
  ) {}

  async requirementChanged({
    organizationId,
    actorUserId,
    required,
    memberUserIds,
  }: {
    organizationId: string;
    actorUserId: string;
    required: boolean;
    memberUserIds: readonly string[];
  }): Promise<void> {
    const { organization, actor, memberships } =
      await this.loadNotificationContext({
        organizationId,
        actorUserId,
        memberUserIds,
      });
    const actorName = actor?.name ?? actor?.email ?? "An administrator";
    const { destinations, failures } =
      await this.resolveNotificationDestinations(memberships);
    failures.push(
      ...(await this.deliverRequirementChange({
        destinations,
        organizationName: organization.name,
        actorName,
        required,
      })),
    );
    this.throwIfNotificationFailed({
      failures,
      organizationId,
      actorUserId,
      required,
      attempted: destinations.size,
    });
  }

  private async loadNotificationContext({
    organizationId,
    actorUserId,
    memberUserIds,
  }: {
    organizationId: string;
    actorUserId: string;
    memberUserIds: readonly string[];
  }): Promise<{
    organization: { name: string };
    actor: { name: string | null; email: string | null } | null;
    memberships: {
      userId: string;
      user: { email: string | null };
    }[];
  }> {
    const [organization, actor, memberships] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: { name: true, email: true },
      }),
      this.prisma.organizationUser.findMany({
        where: {
          organizationId,
          userId: { in: [...new Set(memberUserIds)] },
          disabledAt: null,
        },
        select: { userId: true, user: { select: { email: true } } },
      }),
    ]);
    if (!organization) {
      throw new Error(
        `organization ${organizationId} was not found while notifying members`,
      );
    }
    return { organization, actor, memberships };
  }

  private async resolveNotificationDestinations(
    memberships: readonly {
      userId: string;
      user: { email: string | null };
    }[],
  ): Promise<{ destinations: Map<string, string>; failures: unknown[] }> {
    const destinations = new Map<string, string>();
    const failures: unknown[] = [];
    const resolutions = await Promise.allSettled(
      memberships.map(async ({ userId, user }) => ({
        userId,
        email: await this.resolveDeliveryEmail({
          userId,
          legacyEmail: user.email,
        }),
      })),
    );
    for (const resolution of resolutions) {
      if (resolution.status === "rejected") {
        failures.push(resolution.reason);
        continue;
      }
      const member = resolution.value;
      if (!member.email) {
        failures.push(
          new Error(
            `member ${member.userId} has no email address for the MFA requirement notification`,
          ),
        );
        continue;
      }
      const normalized = normalizeIdentifierValue(member.email);
      if (!destinations.has(normalized)) {
        destinations.set(normalized, member.email);
      }
    }
    return { destinations, failures };
  }

  private async deliverRequirementChange({
    destinations,
    organizationName,
    actorName,
    required,
  }: {
    destinations: ReadonlyMap<string, string>;
    organizationName: string;
    actorName: string;
    required: boolean;
  }): Promise<unknown[]> {
    const deliveries = [...destinations.values()].map((to) =>
      sendOrganizationMfaRequirementEmail({
        to,
        organizationName,
        actorName,
        required,
      }),
    );
    const results = await Promise.allSettled(deliveries);
    return results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
  }

  private throwIfNotificationFailed({
    failures,
    organizationId,
    actorUserId,
    required,
    attempted,
  }: {
    failures: unknown[];
    organizationId: string;
    actorUserId: string;
    required: boolean;
    attempted: number;
  }): void {
    if (failures.length === 0) return;

    logger.error(
      {
        organizationId,
        actorUserId,
        required,
        attempted,
        failed: failures.length,
      },
      "organization MFA requirement notification delivery failed",
    );
    throw new AggregateError(
      failures,
      `failed to notify ${failures.length} organization member(s) about the MFA requirement change`,
    );
  }
}
