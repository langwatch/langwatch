/**
 * The organization and project rows the /me view and a budget-increase request read, which
 * `OrganizationApi` declares no operation for.
 */
export interface UserOrganizationDirectoryRepository {
  findName(organizationId: string): Promise<string | null>;
  /** The caller's first non-archived project in the organization, by age. */
  findFirstProjectSlug(input: { organizationId: string; userId: string }): Promise<string | null>;
  /** The organization's first administrator, by seat age. */
  findFirstAdminEmail(organizationId: string): Promise<string | null>;
}
