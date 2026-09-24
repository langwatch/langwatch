import { JoinRequestNotFoundError } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { JoinRequestAudience } from "../join-request-audience.repository.ts";

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
export class PrismaJoinRequestAudienceRepository extends JoinRequestAudience {
  static create(database: PrismaJoinRequestAudienceDatabase): PrismaJoinRequestAudienceRepository {
    return new PrismaJoinRequestAudienceRepository(database);
  }

  private constructor(private readonly database: PrismaJoinRequestAudienceDatabase) {
    super();
  }

  async getRequesterId({ joinRequestId }: { joinRequestId: string }): Promise<string> {
    const request = await this.database.joinRequest.findUnique({
      where: { id: joinRequestId },
      select: { userId: true },
    });
    if (!request)
      throw new JoinRequestNotFoundError(`join request ${joinRequestId} does not exist`);
    return request.userId;
  }

  async tryFindOrganizationName({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string | null> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    return organization?.name ?? null;
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

  async tryFindDisplayName({ userId }: { userId: string }): Promise<string | null> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    return user?.name ?? user?.email ?? null;
  }

  async tryFindEmail({ userId }: { userId: string }): Promise<string | null> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }
}
