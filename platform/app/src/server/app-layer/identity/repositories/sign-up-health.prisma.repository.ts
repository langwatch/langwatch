import type { PrismaClient } from "~/generated/prisma/client";
import type { FoundedOrganization, LaterMembership } from "../sign-up-health";

/** The identifier states that count as PROOF, the same two the matcher uses:
 *  an address nobody confirmed is not evidence of who somebody works for. */
const VERIFIED_IDENTIFIER_STATES = ["VERIFIED", "PRIMARY"] as const;

/**
 * The rows behind the orphaned-organization rate (D12).
 *
 * Reads only `Organization`, `OrganizationUser` and `Identifier`, all of which
 * have been written since long before this deliverable — which is what makes
 * the rate readable for the period BEFORE the flag was turned on. Nothing here
 * depends on a counter somebody remembered to add.
 *
 * Several plain reads rather than one clever join, for the reason the matcher
 * gives: this is a report, not a hot path, and a number nobody can read the
 * derivation of is a number nobody should act on.
 */
export class PrismaSignUpHealthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Organizations founded in a window, and who founded each.
   *
   * The founder is the earliest membership, because the schema records no
   * creator: `createAndAssign` makes the organization and attaches its
   * creator in the same breath, so the first row IS the person who typed the
   * name.
   */
  async findAllFoundedBetween({
    fromMs,
    toMs,
  }: {
    fromMs: number;
    toMs: number;
  }): Promise<FoundedOrganization[]> {
    const organizations = await this.prisma.organization.findMany({
      where: {
        createdAt: { gte: new Date(fromMs), lte: new Date(toMs) },
      },
      select: { id: true, createdAt: true },
    });
    if (organizations.length === 0) return [];

    const memberships = await this.prisma.organizationUser.findMany({
      where: { organizationId: { in: organizations.map((row) => row.id) } },
      select: { organizationId: true, userId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const founderByOrganization = new Map<string, string>();
    for (const membership of memberships) {
      if (founderByOrganization.has(membership.organizationId)) continue;
      founderByOrganization.set(membership.organizationId, membership.userId);
    }

    return organizations.flatMap((organization) => {
      const founderUserId = founderByOrganization.get(organization.id);
      // An organization with no members at all is not evidence of anything —
      // there is nobody whose later choices could make it orphaned.
      if (!founderUserId) return [];
      return [
        {
          organizationId: organization.id,
          founderUserId,
          foundedAtMs: organization.createdAt.getTime(),
        },
      ];
    });
  }

  /**
   * The memberships those founders later took up in organizations ON THEIR
   * OWN DOMAIN — the "they found their real team" signal.
   *
   * The domain restriction is what keeps the rate honest: somebody who
   * founded a workspace and later joined an unrelated organization has not
   * demonstrated that the first one was a mistake. Somebody who joined one
   * their colleagues were already in has.
   */
  async findAllSameDomainMembershipsSince({
    founderUserIds,
    sinceMs,
    untilMs,
  }: {
    founderUserIds: readonly string[];
    sinceMs: number;
    untilMs: number;
  }): Promise<LaterMembership[]> {
    if (founderUserIds.length === 0) return [];

    const founderIdentifiers = await this.prisma.identifier.findMany({
      where: {
        userId: { in: [...founderUserIds] },
        state: { in: [...VERIFIED_IDENTIFIER_STATES] },
        domain: { not: null },
      },
      select: { userId: true, domain: true },
    });
    const domainByFounder = new Map<string, string>();
    for (const identifier of founderIdentifiers) {
      if (!identifier.domain) continue;
      if (domainByFounder.has(identifier.userId)) continue;
      domainByFounder.set(identifier.userId, identifier.domain);
    }
    if (domainByFounder.size === 0) return [];

    // Asked of ORGANIZATION rather than of the membership rows: a `findMany`
    // over `OrganizationUser` bounded only by `userId` spans every
    // organization at once and the org-tenancy guard refuses it. Same shape as
    // `two-step-verification-adapters.ts`.
    const founderWindow = {
      userId: { in: [...domainByFounder.keys()] },
      createdAt: { gte: new Date(sinceMs), lte: new Date(untilMs) },
    };
    const organizations = await this.prisma.organization.findMany({
      where: { members: { some: founderWindow } },
      select: {
        id: true,
        members: {
          where: founderWindow,
          select: { userId: true, createdAt: true },
        },
      },
    });
    const memberships = organizations.flatMap((organization) =>
      organization.members.map((member) => ({
        organizationId: organization.id,
        userId: member.userId,
        createdAt: member.createdAt,
      })),
    );
    if (memberships.length === 0) return [];

    const domainsHeld = await this.organizationsHoldingDomains({
      organizationIds: [
        ...new Set(memberships.map((membership) => membership.organizationId)),
      ],
      domains: [...new Set(domainByFounder.values())],
    });

    return memberships.flatMap((membership) => {
      const domain = domainByFounder.get(membership.userId);
      if (!domain) return [];
      if (!domainsHeld.get(membership.organizationId)?.has(domain)) return [];
      return [
        {
          organizationId: membership.organizationId,
          userId: membership.userId,
          joinedAtMs: membership.createdAt.getTime(),
        },
      ];
    });
  }

  /** Which of these organizations hold a verified member on each domain. */
  private async organizationsHoldingDomains({
    organizationIds,
    domains,
  }: {
    organizationIds: readonly string[];
    domains: readonly string[];
  }): Promise<Map<string, Set<string>>> {
    const held = new Map<string, Set<string>>();
    if (organizationIds.length === 0 || domains.length === 0) return held;

    const identifiers = await this.prisma.identifier.findMany({
      where: {
        domain: { in: [...domains] },
        state: { in: [...VERIFIED_IDENTIFIER_STATES] },
      },
      select: { userId: true, domain: true },
    });
    if (identifiers.length === 0) return held;

    const memberships = await this.prisma.organizationUser.findMany({
      where: {
        organizationId: { in: [...organizationIds] },
        userId: { in: identifiers.map((identifier) => identifier.userId) },
      },
      select: { organizationId: true, userId: true },
    });

    const domainsByUser = groupDomainsByUser(identifiers);

    for (const membership of memberships) {
      const organizationDomains =
        held.get(membership.organizationId) ?? new Set<string>();
      for (const domain of domainsByUser.get(membership.userId) ?? []) {
        organizationDomains.add(domain);
      }
      held.set(membership.organizationId, organizationDomains);
    }
    return held;
  }
}

/** Which verified domains each person holds. A row with no domain is an
 *  identifier that is not an address, and it belongs to nobody's domain. */
function groupDomainsByUser(
  identifiers: readonly { userId: string; domain: string | null }[],
): Map<string, Set<string>> {
  const domainsByUser = new Map<string, Set<string>>();
  for (const identifier of identifiers) {
    if (!identifier.domain) continue;
    const held = domainsByUser.get(identifier.userId) ?? new Set<string>();
    held.add(identifier.domain);
    domainsByUser.set(identifier.userId, held);
  }
  return domainsByUser;
}
