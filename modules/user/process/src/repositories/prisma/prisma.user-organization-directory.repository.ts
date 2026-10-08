import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { NEVER_LANDED_ON_PROJECT_KINDS } from "@langwatch/project-contract";
import type { MeProject } from "@langwatch/user-contract";

import type { UserOrganizationDirectoryRepository } from "../user-organization-directory.repository.ts";

/** Only what this repository touches, so composition names the slice it needs. */
type UserOrganizationDirectoryDatabase = Pick<
  PrismaClient,
  "organization" | "organizationUser" | "project"
>;

/**
 * The `/me` view's own reads of organization and project rows — none of
 * these tables belong to this module, but the reads are narrow, local to
 * what `/me` renders, and read through this module's own repository.
 */
export class PrismaUserOrganizationDirectoryRepository implements UserOrganizationDirectoryRepository {
  static create({
    prisma,
  }: {
    prisma: UserOrganizationDirectoryDatabase;
  }): PrismaUserOrganizationDirectoryRepository {
    return new PrismaUserOrganizationDirectoryRepository(prisma);
  }

  private constructor(private readonly database: UserOrganizationDirectoryDatabase) {}

  async findName(organizationId: string): Promise<string | null> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    return organization?.name ?? null;
  }

  async findFirstProjectSlug(input: {
    organizationId: string;
    userId: string;
  }): Promise<string | null> {
    const project = await this.database.project.findFirst({
      where: {
        team: { organizationId: input.organizationId, members: { some: { userId: input.userId } } },
        archivedAt: null,
        // Never an aggregate, opened on purpose, nor the governance project (ADR-175).
        kind: { notIn: [...NEVER_LANDED_ON_PROJECT_KINDS] },
      },
      orderBy: { createdAt: "asc" },
      select: { slug: true },
    });
    return project?.slug ?? null;
  }

  async findPersonalProjectId(input: {
    organizationId: string;
    userId: string;
  }): Promise<string | null> {
    const project = await this.database.project.findFirst({
      where: {
        isPersonal: true,
        ownerUserId: input.userId,
        archivedAt: null,
        team: { organizationId: input.organizationId, isPersonal: true },
      },
      select: { id: true },
    });
    return project?.id ?? null;
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

  findKeyProject({ projectId }: { projectId: string }): Promise<MeProject | null> {
    return this.database.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, slug: true, isPersonal: true },
    });
  }
}
