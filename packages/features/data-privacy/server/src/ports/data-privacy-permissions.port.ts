/**
 * What one caller may do at each tier of the privacy scope chain.
 *
 * Three questions, because the settings page asks three: an organization
 * manager writes ORGANIZATION and DEPARTMENT rules, a team manager writes TEAM
 * rules, and a project member with `project:update` writes PROJECT rules. The
 * read side advertises a scope as writable using EXACTLY these answers, so the
 * chip picker can never offer a scope the save then rejects.
 *
 * The batched shapes are batched on purpose: an organization's project list is
 * every project it holds, and one probe per row is one round trip per row.
 */
export abstract class DataPrivacyPermissionsPort {
  abstract canManageOrganization(input: {
    userId: string;
    organizationId: string;
  }): Promise<boolean>;

  /** `team:manage` per id, in a map keyed by the id asked for. */
  abstract canManageTeams(input: {
    userId: string;
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>>;

  /** `project:update` per id, in a map keyed by the id asked for. */
  abstract canUpdateProjects(input: {
    userId: string;
    organizationId: string | null;
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>>;
}
