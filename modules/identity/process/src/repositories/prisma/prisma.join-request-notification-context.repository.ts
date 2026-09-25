import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { JoinRequestNotificationContextRepository } from "../join-request-notification-context.repository.ts";

/** Only what this repository touches, so composition names the slice it needs. */
export type JoinRequestNotificationContextDatabase = Pick<
  PrismaClient,
  "organization" | "joinRequest" | "team"
>;

/** The notification context, read from the organization, join-request and team tables. */
export class PrismaJoinRequestNotificationContextRepository extends JoinRequestNotificationContextRepository {
  static create(
    database: JoinRequestNotificationContextDatabase,
  ): PrismaJoinRequestNotificationContextRepository {
    return new PrismaJoinRequestNotificationContextRepository(database);
  }

  private constructor(private readonly database: JoinRequestNotificationContextDatabase) {
    super();
  }

  /**
   * Why the organization came, for the one message a new member reads first.
   * A null intent is a supported answer — plenty of organizations never said.
   * Throws `OrganizationNotFoundError` when no organization carries this id.
   */
  async getOrganizationIntent(
    organizationId: string,
  ): Promise<Readonly<{ primaryIntent: "AGENT_GOVERNANCE" | "LLM_OPS" | null }>> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { primaryIntent: true },
    });
    if (!organization) throw new OrganizationNotFoundError(organizationId);

    return organization;
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
   * The requester's own personal teams across organizations, oldest first.
   * Empty when they have none yet, the ordinary case for a first sign-in.
   */
  async findPersonalTeamSlugs(userId: string): Promise<string[]> {
    const teams = await this.database.team.findMany({
      where: { ownerUserId: userId, isPersonal: true },
      select: { slug: true },
      orderBy: { createdAt: "asc" },
    });
    return teams.map((team) => team.slug);
  }
}
