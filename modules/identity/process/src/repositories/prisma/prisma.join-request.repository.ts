import {
  DEFAULT_DOMAIN_JOIN_SETTING,
  DOMAIN_JOIN_SETTINGS,
  type DomainJoinSetting,
  isPublicEmailDomain,
  type JoinCandidateOrganization,
  type JoinRequestAggregateState,
  qualifySsoDomainOwnership,
  ssoConnectionSourceSchema,
  ssoDomainVerificationSchema,
} from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

import type {
  JoinCandidateRepository,
  JoinRequestListReadRepository,
} from "../join-request.repository.ts";
import { PrismaJoinRequestProjectionRepository } from "./prisma.join-request-projection.repository.ts";

/**
 * One connection row, qualified on the looked-up domain (ADR-123). Both
 * columns are parsed rather than asserted, and a column that does not parse
 * reads as no proof: this is the decision that grants authority over a domain.
 */
function connectionHasQualifiedProof(
  row: { source: string; verifiedDomains: string[]; domainVerifications: unknown },
  domain: string,
): boolean {
  const verifications = z.array(ssoDomainVerificationSchema).safeParse(row.domainVerifications);
  const source = ssoConnectionSourceSchema.safeParse(row.source);

  return (
    qualifySsoDomainOwnership({
      state: {
        source: source.success ? source.data : "self-serve",
        verifiedDomains: row.verifiedDomains,
        domainVerifications: verifications.success ? verifications.data : [],
      },
      domain,
    }).status === "QUALIFIED"
  );
}

/**
 * What the join-request guards and the matcher read, out of Postgres (D12). The whole file answers
 * in counts and flags.
 */

/** The identifier states that count as PROOF. ATTACHED is a typed-in address
 *  nobody confirmed, and counting one would let anybody make any organization
 *  look like theirs by typing an address at it. */
const VERIFIED_IDENTIFIER_STATES = ["VERIFIED", "PRIMARY"] as const;

export class PrismaJoinRequestReadRepository implements JoinRequestListReadRepository {
  static create(prisma: PrismaClient): PrismaJoinRequestReadRepository {
    return new PrismaJoinRequestReadRepository(prisma);
  }

  constructor(private readonly prisma: PrismaClient) {}

  async tryFindRequest({
    joinRequestId,
  }: {
    joinRequestId: string;
  }): Promise<JoinRequestAggregateState | null> {
    const row = await this.prisma.joinRequest.findUnique({
      where: { id: joinRequestId },
    });
    return row ? PrismaJoinRequestProjectionRepository.rowToJoinRequest(row) : null;
  }

  async tryFindPendingRequest({
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
    return row ? PrismaJoinRequestProjectionRepository.rowToJoinRequest(row) : null;
  }

  /** The cool-down read: when this person was last told no by this
   *  organization. Null when they never were. */
  async tryFindLastRejectionAt({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<Instant | null> {
    const row = await this.prisma.joinRequest.findFirst({
      where: { userId, organizationId, state: "REJECTED" },
      orderBy: { resolvedAt: "desc" },
      select: { resolvedAt: true },
    });
    return row?.resolvedAt ? fromDate(row.resolvedAt) : null;
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
    return rows.map((row) => PrismaJoinRequestProjectionRepository.rowToJoinRequest(row));
  }

  /** Newest first, off the same projection the pending list reads. */
  async findAutomaticJoinsForOrganization({
    organizationId,
    resolvedAfterMs,
  }: {
    organizationId: string;
    resolvedAfterMs: number;
  }): Promise<JoinRequestAggregateState[]> {
    const rows = await this.prisma.joinRequest.findMany({
      where: {
        organizationId,
        state: "APPROVED",
        resolvedByType: "policy",
        resolvedAt: { gte: toDate(Temporal.Instant.fromEpochMilliseconds(resolvedAfterMs)) },
      },
      orderBy: { resolvedAt: "desc" },
    });
    return rows.map((row) => PrismaJoinRequestProjectionRepository.rowToJoinRequest(row));
  }

  /** Everything one person is waiting on. */
  async findPendingForUser({ userId }: { userId: string }): Promise<JoinRequestAggregateState[]> {
    const rows = await this.prisma.joinRequest.findMany({
      where: { userId, state: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => PrismaJoinRequestProjectionRepository.rowToJoinRequest(row));
  }

  async findApprovedForMembers({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<JoinRequestAggregateState[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.joinRequest.findMany({
      where: { organizationId, userId: { in: [...userIds] }, state: "APPROVED" },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => PrismaJoinRequestProjectionRepository.rowToJoinRequest(row));
  }
}

/**
 * Which organizations a domain could reach, as the matcher needs to see them.
 */
export class PrismaJoinCandidateRepository implements JoinCandidateRepository {
  static create(prisma: PrismaClient): PrismaJoinCandidateRepository {
    return new PrismaJoinCandidateRepository(prisma);
  }

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
      const held = verifiedByOrganization.get(membership.organizationId) ?? new Set<string>();
      held.add(membership.userId);
      verifiedByOrganization.set(membership.organizationId, held);
    }

    return this.describe({
      organizationIds: [...verifiedByOrganization.keys()],
      domain,
      verifiedByOrganization,
    });
  }

  async tryFindCandidateOrganization({
    organizationId,
    domain,
  }: {
    organizationId: string;
    domain: string;
  }): Promise<JoinCandidateOrganization | null> {
    const candidates = await this.findCandidateOrganizations({ domain });
    return candidates.find((candidate) => candidate.organizationId === organizationId) ?? null;
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
    const [organizations, memberCounts, connections] = await Promise.all([
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
      // An identity provider that already admits this domain is the way in,
      // and joining is not offered beside it. Every connection carrying the
      // domain is read, not only the active ones: a lapsed or torn-down
      // proof answers both questions below differently.
      this.prisma.ssoConnection.findMany({
        where: {
          organizationId: { in: organizationIds },
          verifiedDomains: { has: domain },
        },
        select: {
          organizationId: true,
          source: true,
          verifiedDomains: true,
          domainVerifications: true,
          state: true,
        },
      }),
    ]);

    const memberCountByOrganization = new Map(
      memberCounts.map((row) => [row.organizationId, row._count.userId]),
    );
    // A connection whose proof on this domain LAPSED admits nobody new
    // through it (ADR-123), so it no longer stands in the way of asking.
    const admittedByConnection = new Set(
      connections
        .filter((row) => row.state === "ACTIVE" && connectionHasQualifiedProof(row, domain))
        .map((row) => row.organizationId),
    );
    // A live proof on ANY connection that still exists. The terminal states
    // matter here and nowhere else: the reducer keeps `verifiedDomains`
    // through teardown, so without them an organization that proved a domain
    // and then removed the connection would walk strangers in years later.
    const provedByConnection = new Set(
      connections
        .filter(
          (row) =>
            connectionHasQualifiedProof(row, domain) &&
            row.state !== "DISCARDED" &&
            row.state !== "TORN_DOWN",
        )
        .map((row) => row.organizationId),
    );

    return organizations.map((organization) => ({
      organizationId: organization.id,
      name: organization.name,
      domainJoin: PrismaJoinCandidateRepository.readDomainJoin(organization.domainJoin),
      // The legacy `ssoDomain` string counts too, and on purpose: until the
      // connection projection routes sign-in it is what actually admits
      // people, and an organization whose provider already lets colleagues in
      // must not also be offered as somewhere to ask.
      connectionAdmitsDomain:
        admittedByConnection.has(organization.id) || organization.ssoDomain === domain,
      verifiedMembersOnDomain: verifiedByOrganization.get(organization.id)?.size ?? 0,
      memberCount: memberCountByOrganization.get(organization.id) ?? 0,
      autoJoinDomains: organization.joinDomains,
      // Authorizes walking straight in, and nothing else. Asking still runs
      // on members plus a human who approves.
      domainProved: provedByConnection.has(organization.id),
    }));
  }

  /**
   * A stored setting back into the vocabulary. An unrecognised value reads as the default rather
   * than throwing: a column somebody hand-edited must not be able to take an organization's
   * members' sign-in down, and `request` is the setting that needs an admin's approval anyway.
   */
  static readDomainJoin(stored: string): DomainJoinSetting {
    return (DOMAIN_JOIN_SETTINGS as readonly string[]).includes(stored)
      ? (stored as DomainJoinSetting)
      : DEFAULT_DOMAIN_JOIN_SETTING;
  }
}
