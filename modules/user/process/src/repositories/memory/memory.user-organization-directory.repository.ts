import type { UserOrganizationDirectoryRepository } from "../user-organization-directory.repository.ts";

/** One organization as the memory directory holds it. */
type MemoryUserDirectoryOrganization = Readonly<{
  name?: string;
  firstAdminEmail?: string;
  /** The first project slug each member sees, by user id. */
  firstProjectSlugs?: Readonly<Record<string, string>>;
}>;

/** The directory's memory twin: the organizations it was seeded with, keyed by id. */
export class MemoryUserOrganizationDirectoryRepository implements UserOrganizationDirectoryRepository {
  static create(
    organizations: Readonly<Record<string, MemoryUserDirectoryOrganization>> = {},
  ): MemoryUserOrganizationDirectoryRepository {
    return new MemoryUserOrganizationDirectoryRepository(organizations);
  }

  private constructor(
    private readonly organizations: Readonly<Record<string, MemoryUserDirectoryOrganization>>,
  ) {}

  async findName(organizationId: string): Promise<string | null> {
    return this.organizations[organizationId]?.name ?? null;
  }

  async findFirstProjectSlug(input: {
    organizationId: string;
    userId: string;
  }): Promise<string | null> {
    return this.organizations[input.organizationId]?.firstProjectSlugs?.[input.userId] ?? null;
  }

  async findFirstAdminEmail(organizationId: string): Promise<string | null> {
    return this.organizations[organizationId]?.firstAdminEmail ?? null;
  }
}
