import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { AuthDirectoryPort, type AuthDirectoryProject } from "../../ports/auth-directory.port";

type Database = Pick<PrismaClient, "user" | "organization" | "organizationUser" | "project">;

export class PrismaAuthDirectoryRepository extends AuthDirectoryPort {
  private constructor(private readonly database: Database) {
    super();
  }

  static create(database: Database): PrismaAuthDirectoryRepository {
    return new PrismaAuthDirectoryRepository(database);
  }

  async tryFindOrganizationIdBySsoDomain(domain: string): Promise<string | null> {
    const organization = await this.database.organization.findUnique({
      where: { ssoDomain: domain },
      select: { id: true },
    });
    return organization?.id ?? null;
  }

  async tryFindPerson(
    userId: string,
  ): Promise<{ id: string; email: string | null; name: string | null } | null> {
    return await this.database.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
  }

  async tryFindOrganization(
    organizationId: string,
  ): Promise<{ id: string; name: string; slug: string } | null> {
    return await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });
  }

  async maxSessionDurationDays(organizationId: string): Promise<number> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { maxSessionDurationDays: true },
    });
    return organization?.maxSessionDurationDays ?? 0;
  }

  async hasActiveMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    const membership = await this.database.organizationUser.findFirst({
      where: { userId, organizationId, disabledAt: null },
      select: { userId: true },
    });
    return membership !== null;
  }

  async tryFindLiveProject({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string;
  }): Promise<AuthDirectoryProject | null> {
    return await this.database.project.findFirst({
      where: { id: projectId, archivedAt: null, team: { organizationId } },
      select: {
        id: true,
        slug: true,
        name: true,
        apiKey: true,
        isPersonal: true,
        ownerUserId: true,
      },
    });
  }
}
