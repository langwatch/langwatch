import type { PrismaClient } from "@langwatch/prisma-client/generated";

/** Only what this repository touches, so composition names the slice it needs. */
export type JoinRequestNotificationContextDatabase = Pick<
  PrismaClient,
  "organization" | "joinRequest" | "team"
>;

/**
 * The extra context a join-request notification's copy carries, beyond who
 * to address: why the organization exists, how many requests from a domain
 * were already approved, and a lapsed requester's own personal project link.
 */
export class PrismaJoinRequestNotificationContextRepository {
  static create(
    database: JoinRequestNotificationContextDatabase,
  ): PrismaJoinRequestNotificationContextRepository {
    return new PrismaJoinRequestNotificationContextRepository(database);
  }

  private constructor(private readonly database: JoinRequestNotificationContextDatabase) {}

  /**
   * Why the organization came, for the one message a new member reads first.
   * Null is a supported answer — plenty of organizations never said.
   */
  async tryFindOrganizationIntent(
    organizationId: string,
  ): Promise<"AGENT_GOVERNANCE" | "LLM_OPS" | null> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { primaryIntent: true },
    });

    return organization?.primaryIntent ?? null;
  }

  /** How many join requests from this domain have already been approved. */
  async countApprovedFromDomain(input: {
    organizationId: string;
    domain: string;
  }): Promise<number> {
    return this.database.joinRequest.count({
      where: { organizationId: input.organizationId, domain: input.domain, state: "APPROVED" },
    });
  }

  /**
   * A personal project of the requester's own, in any organization they
   * already hold one in. Null when they have none yet, the ordinary case for
   * somebody who has never signed in before.
   */
  async tryFindPersonalTeamSlug(userId: string): Promise<string | null> {
    const team = await this.database.team.findFirst({
      where: { ownerUserId: userId, isPersonal: true },
      select: { slug: true },
      orderBy: { createdAt: "asc" },
    });
    return team?.slug ?? null;
  }
}
