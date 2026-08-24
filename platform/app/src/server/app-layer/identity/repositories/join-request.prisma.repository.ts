import {
  DEFAULT_DOMAIN_JOIN_SETTING,
  type DomainJoinSetting,
  DOMAIN_JOIN_SETTINGS,
  isPublicEmailDomain,
  type JoinCandidateOrganization,
  type JoinRequestAggregateState,
} from "@langwatch/identity";
import type {
  JoinCandidateRepository,
  JoinRequestReadRepository,
} from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { rowToJoinRequest } from "./join-request-projection.prisma.repository";

/**
 * What the join-request guards and the matcher read, out of Postgres (D12).
 *
 * The whole file answers in counts and flags. No member of any organization
 * is ever named to make a join decision, and no query here returns an email
 * address — which is what keeps the lookup from becoming a directory of who
 * works where even by accident.
 */

/** The identifier states that count as PROOF. ATTACHED is a typed-in address
 *  nobody confirmed, and counting one would let anybody make any organization
 *  look like theirs by typing an address at it. */
const VERIFIED_IDENTIFIER_STATES = ["VERIFIED", "PRIMARY"] as const;

export class PrismaJoinRequestReadRepository
  implements JoinRequestReadRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findRequest({
    joinRequestId,
  }: {
    joinRequestId: string;
  }): Promise<JoinRequestAggregateState | null> {
    const row = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId },
    });
    return row ? rowToJoinRequest(row) : null;
  }

  async findPendingRequest({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<JoinRequestAggregateState | null> {
    const row = await this.prisma.joinRequest.findFirst({
      where: { userId, organizationId, state: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return row ? rowToJoinRequest(row) : null;
  }

  /** The cool-down read: when this person was last told no by this
   *  organization. Null when they never were. */
  async findLastRejectionAt({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<Date | null> {
    const row = await this.prisma.joinRequest.findFirst({
      where: { userId, organizationId, state: "REJECTED" },
      orderBy: { resolvedAt: "desc" },
      select: { resolvedAt: true },
    });
    return row?.resolvedAt ?? null;
  }

  /** Everything waiting on one organization, newest ask first. */
  async findPendingForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<JoinRequestAggregateState[]> {
    const rows = await this.prisma.joinRequest.findMany({
      where: { organizationId, state: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(rowToJoinRequest);
  }

  /** Everything one person is waiting on. */
  async findPendingForUser({
    userId,
  }: {
    userId: string;
  }): Promise<JoinRequestAggregateState[]> {
    const rows = await this.prisma.joinRequest.findMany({
      where: { userId, state: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(rowToJoinRequest);
  }
}

/**
 * Which organizations a domain could reach, as the matcher needs to see them.
 *
 * Four reads, deliberately separate rather than one clever join: who holds a
 * verified address on the domain, which organizations those people are in,
 * how big those organizations are, and whether an identity provider already
 * admits the domain. Each is an index seek, and each is legible on its own —
 * a matching rule nobody can read is a matching rule nobody can audit.
 */
export class PrismaJoinCandidateRepository implements JoinCandidateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findCandidateOrganizations({
    domain,
  }: {
    domain: string;
  }): Promise<JoinCandidateOrganization[]> {
    // The structural half of "a public email domain never matches": the query
    // does not run at all, so no consumer-mail domain can reach a candidate
    // list even if a caller forgot to check. The matcher checks again.
    if (!domain || isPublicEmailDomain(domain)) return [];

    const verifiedOnDomain = await this.prisma.identifier.findMany({
      where: { domain, state: { in: [...VERIFIED_IDENTIFIER_STATES] } },
      select: { userId: true },
      distinct: ["userId"],
    });
    const userIds = verifiedOnDomain.map((row) => row.userId);
    if (userIds.length === 0) return [];

    const memberships = await this.prisma.organizationUser.findMany({
      where: { userId: { in: userIds }, disabledAt: null },
      select: { organizationId: true, userId: true },
    });
    if (memberships.length === 0) return [];

    const verifiedByOrganization = new Map<string, Set<string>>();
    for (const membership of memberships) {
      const held =
        verifiedByOrganization.get(membership.organizationId) ??
        new Set<string>();
      held.add(membership.userId);
      verifiedByOrganization.set(membership.organizationId, held);
    }

    return this.describe({
      organizationIds: [...verifiedByOrganization.keys()],
      domain,
      verifiedByOrganization,
    });
  }

  async findCandidateOrganization({
    organizationId,
    domain,
  }: {
    organizationId: string;
    domain: string;
  }): Promise<JoinCandidateOrganization | null> {
    const candidates = await this.findCandidateOrganizations({ domain });
    return (
      candidates.find(
        (candidate) => candidate.organizationId === organizationId,
      ) ?? null
    );
  }

  private async describe({
    organizationIds,
    domain,
    verifiedByOrganization,
  }: {
    organizationIds: string[];
    domain: string;
    verifiedByOrganization: Map<string, Set<string>>;
  }): Promise<JoinCandidateOrganization[]> {
    const [organizations, memberCounts, sharedTeams, connections] =
      await Promise.all([
        this.prisma.organization.findMany({
          where: { id: { in: organizationIds } },
          select: {
            id: true,
            name: true,
            domainJoin: true,
            joinDomains: true,
            ssoDomain: true,
          },
        }),
        // A second groupBy rather than a `_count` relation include: Prisma
        // builds that as an uncorrelated join and the planner can re-run the
        // aggregate once per listed row.
        this.prisma.organizationUser.groupBy({
          by: ["organizationId"],
          where: { organizationId: { in: organizationIds }, disabledAt: null },
          _count: { userId: true },
        }),
        // "Not a personal organization", structurally: one that has at least
        // one SHARED team. A workspace whose only teams are personal is a
        // place one person made for themselves, and offering a stranger their
        // way into it is exactly the mistake this deliverable exists to stop.
        this.prisma.team.findMany({
          where: { organizationId: { in: organizationIds }, isPersonal: false },
          select: { organizationId: true },
          distinct: ["organizationId"],
        }),
        // An identity provider that already admits this domain is the way in,
        // and joining is not offered beside it.
        this.prisma.ssoConnection.findMany({
          where: {
            organizationId: { in: organizationIds },
            state: "ACTIVE",
            verifiedDomains: { has: domain },
          },
          select: { organizationId: true },
        }),
      ]);

    const memberCountByOrganization = new Map(
      memberCounts.map((row) => [row.organizationId, row._count.userId]),
    );
    const organizationsWithSharedTeam = new Set(
      sharedTeams.map((row) => row.organizationId),
    );
    const admittedByConnection = new Set(
      connections.map((row) => row.organizationId),
    );

    return organizations.map((organization) => ({
      organizationId: organization.id,
      name: organization.name,
      domainJoin: readDomainJoin(organization.domainJoin),
      isPersonal: !organizationsWithSharedTeam.has(organization.id),
      // The legacy `ssoDomain` string counts too, and on purpose: until the
      // connection projection routes sign-in it is what actually admits
      // people, and an organization whose provider already lets colleagues in
      // must not also be offered as somewhere to ask.
      connectionAdmitsDomain:
        admittedByConnection.has(organization.id) ||
        organization.ssoDomain === domain,
      verifiedMembersOnDomain:
        verifiedByOrganization.get(organization.id)?.size ?? 0,
      memberCount: memberCountByOrganization.get(organization.id) ?? 0,
      autoJoinDomains: organization.joinDomains,
    }));
  }
}

/**
 * A stored setting back into the vocabulary. An unrecognised value reads as
 * the default rather than throwing: a column somebody hand-edited must not be
 * able to take an organization's members' sign-in down, and `request` is the
 * setting that needs an admin's approval anyway.
 */
export function readDomainJoin(stored: string): DomainJoinSetting {
  return (DOMAIN_JOIN_SETTINGS as readonly string[]).includes(stored)
    ? (stored as DomainJoinSetting)
    : DEFAULT_DOMAIN_JOIN_SETTING;
}
