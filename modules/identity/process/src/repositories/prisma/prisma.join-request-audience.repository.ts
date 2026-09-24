import { JoinRequestNotFoundError } from "@langwatch/identity-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { UserNotFoundError } from "@langwatch/user-contract";

import type {
  JoinRequestAudienceRepository,
  JoinRequestAudienceProfile,
} from "../join-request-audience.repository.ts";

/** Every model a join-request notification reads, and no other. */
export type PrismaJoinRequestAudienceDatabase = Pick<
  PrismaClient,
  "joinRequest" | "organization" | "organizationUser" | "user"
>;

/**
 * Who a join-request notification reaches, out of Postgres. The admin read
 * filters `disabledAt: null` — a deactivated admin cannot answer. No query
 * carries `projectId`: these identity tables are exempt, having no column.
 */
export class PrismaJoinRequestAudienceRepository implements JoinRequestAudienceRepository {
  static create(database: PrismaJoinRequestAudienceDatabase): PrismaJoinRequestAudienceRepository {
    return new PrismaJoinRequestAudienceRepository(database);
  }

  private constructor(private readonly database: PrismaJoinRequestAudienceDatabase) {}

  async getRequesterId({ joinRequestId }: { joinRequestId: string }): Promise<string> {
    const request = await this.database.joinRequest.findUnique({
      where: { id: joinRequestId },
      select: { userId: true },
    });
    if (!request)
      throw new JoinRequestNotFoundError(`join request ${joinRequestId} does not exist`);
    return request.userId;
  }

  async getOrganizationName({ organizationId }: { organizationId: string }): Promise<string> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    if (!organization) throw new OrganizationNotFoundError(organizationId);
    return organization.name;
  }

  async findAdminEmails({ organizationId }: { organizationId: string }): Promise<string[]> {
    const admins = await this.database.organizationUser.findMany({
      where: { organizationId, role: "ADMIN", disabledAt: null },
      select: { user: { select: { email: true } } },
    });
    return admins
      .map((admin) => admin.user.email)
      .filter((email): email is string => Boolean(email));
  }

  async getUserProfile({ userId }: { userId: string }): Promise<JoinRequestAudienceProfile> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    if (!user) throw new UserNotFoundError(userId);
    return { name: user.name, email: user.email };
  }
}
