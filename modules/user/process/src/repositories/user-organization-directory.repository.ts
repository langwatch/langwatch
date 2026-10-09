import type { MeProject } from "@langwatch/user-contract";

/**
 * The organization and project rows the /me view and a budget-increase request read, which
 * `OrganizationApi` declares no operation for; project rows through project's share (R40).
 */
export interface UserOrganizationDirectoryRepository {
  findName(organizationId: string): Promise<string | null>;
  /** The caller's first non-archived project in the organization, by age. */
  findFirstProjectSlug(input: { organizationId: string; userId: string }): Promise<string | null>;
  /** The organization's first administrator, by seat age. */
  findFirstAdminEmail(organizationId: string): Promise<string | null>;
  /** The project an API key belongs to, as `/api/me/project` names it. */
  findKeyProject(input: { projectId: string }): Promise<MeProject | null>;
}
