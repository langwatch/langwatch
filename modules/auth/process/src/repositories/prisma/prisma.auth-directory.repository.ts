import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { UserNotFoundError } from "@langwatch/user-contract";

type Database = Pick<PrismaClient, "user" | "organization" | "organizationUser" | "project">;

export class PrismaAuthDirectoryRepository {
  private constructor(private readonly database: Database) {}

  static create(database: Database): PrismaAuthDirectoryRepository {
    return new PrismaAuthDirectoryRepository(database);
  }

  async getOrganizationIdBySsoDomain(domain: string): Promise<string> {
    const organization = await this.database.organization.findUnique({
      where: { ssoDomain: domain },
      select: { id: true },
    });
    if (organization === null) throw new OrganizationNotFoundError();
    return organization.id;
  }

  async getPerson(
    userId: string,
  ): Promise<{ id: string; email: string | null; name: string | null }> {
    const person = await this.database.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (person === null) throw new UserNotFoundError(userId);
    return person;
  }

  async getOrganization(
    organizationId: string,
  ): Promise<{ id: string; name: string; slug: string }> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });
    if (organization === null) throw new OrganizationNotFoundError(organizationId);
    return organization;
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
  }): Promise<{
    id: string;
    slug: string;
    name: string;
    apiKey: string;
    isPersonal: boolean;
    ownerUserId: string | null;
  } | null> {
    return this.database.project.findFirst({
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
