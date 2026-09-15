import type { PrismaClient } from "@langwatch/prisma-client/generated";

/** Only what this repository touches, so composition names the slice it needs. */
export type UserOrganizationDirectoryDatabase = Pick<
  PrismaClient,
  "organization" | "organizationUser" | "project"
>;

/**
 * The `/me` view's own reads of organization and project rows: none of these
 * tables belong to this module, but the reads are narrow and local to what
 * `/me` renders, through this module's own repository — the same pattern
 * every other module reading a peer's table for a directory concern follows.
 */
export class PrismaUserOrganizationDirectoryRepository {
  static create(
    database: UserOrganizationDirectoryDatabase,
  ): PrismaUserOrganizationDirectoryRepository {
    return new PrismaUserOrganizationDirectoryRepository(database);
  }

  private constructor(private readonly database: UserOrganizationDirectoryDatabase) {}

  async findName(organizationId: string): Promise<string | null> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    return organization?.name ?? null;
  }

  async findFirstProjectSlug(input: { organizationId: string; userId: string }): Promise<string | null> {
    const project = await this.database.project.findFirst({
      where: {
        team: { organizationId: input.organizationId, members: { some: { userId: input.userId } } },
        archivedAt: null,
      },
      orderBy: { createdAt: "asc" },
      select: { slug: true },
    });
    return project?.slug ?? null;
  }

  /** The organization's first administrator, by seat age. */
  async findFirstAdminEmail(organizationId: string): Promise<string | null> {
    const admin = await this.database.organizationUser.findFirst({
      where: { organizationId, role: "ADMIN", disabledAt: null },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { email: true } } },
    });

    return admin?.user.email ?? null;
  }
}
