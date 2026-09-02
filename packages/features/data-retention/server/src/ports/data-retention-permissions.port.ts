/**
 * What one caller may do at each tier of the retention scope chain.
 *
 * The read side advertises a scope as writable using EXACTLY these answers, so
 * the chip picker can never offer a scope the save then rejects. PROJECT is
 * `project:update` rather than `project:manage` deliberately: a team MEMBER
 * holds the first and not the second, and the snapshot already shows them
 * their own project as writable.
 *
 * The batched shapes are batched on purpose: an organization's project list is
 * every project it holds, and one probe per row is one round trip per row.
 */
export abstract class DataRetentionPermissionsPort {
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

  /**
   * `traces:view` per id — what narrows the storage rollup to the projects the
   * reader could have opened anyway.
   */
  abstract canViewTraces(input: {
    userId: string;
    organizationId: string;
    projectIds: readonly string[];
  }): Promise<ReadonlyMap<string, boolean>>;
}
