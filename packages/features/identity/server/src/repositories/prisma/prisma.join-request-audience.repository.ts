import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { JoinRequestAudiencePort } from "../../ports/join-request-audience.port";

/** Every model a join-request notification reads, and no other. */
export type PrismaJoinRequestAudienceDatabase = Pick<
  PrismaClient,
  "joinRequest" | "organization" | "organizationUser" | "user"
>;

/**
 * Who a join-request notification reaches, out of Postgres.
 *
 * Four reads and a lookup, all of them by primary key or by one index. The
 * admin read filters `disabledAt: null` because a deactivated admin is not
 * somebody who can answer the request, and mailing them would be telling a
 * former colleague who is trying to join.
 *
 * These are identity-side tables under the multitenancy middleware's
 * Identifier/Account exemption plus the organization models, so no query here
 * carries a `projectId` — a join request is not scoped to a project, and none
 * of these models has the column.
 */
export class PrismaJoinRequestAudienceRepository extends JoinRequestAudiencePort {
  static create(database: PrismaJoinRequestAudienceDatabase): PrismaJoinRequestAudienceRepository {
    return new PrismaJoinRequestAudienceRepository(database);
  }

  private constructor(private readonly database: PrismaJoinRequestAudienceDatabase) {
    super();
  }

  async tryFindRequesterId({ joinRequestId }: { joinRequestId: string }): Promise<string | null> {
    const request = await this.database.joinRequest.findUnique({
      where: { id: joinRequestId },
      select: { userId: true },
    });
    return request?.userId ?? null;
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
