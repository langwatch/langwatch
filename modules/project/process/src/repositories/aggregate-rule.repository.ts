/**
 * ADR-175: the project rows an aggregate rule reads, scoped to one organisation
 * through the team. Archived projects and teams are left out, and so are the
 * governance project and other aggregates, which an aggregate never reads.
 */
export interface AggregateRuleRepository {
  /** Every readable personal project of the organisation with its owner, ordered by id. */
  findPersonalProjects(input: {
    organizationId: string;
  }): Promise<{ id: string; ownerUserId: string | null }[]>;
  /** The named ids that are readable projects of the organisation, ordered by id. */
  findReadableProjectIds(input: {
    organizationId: string;
    projectIds: readonly string[];
  }): Promise<string[]>;
  /** Every readable project of the organisation, ordered by name then id. */
  findCandidateProjects(input: {
    organizationId: string;
  }): Promise<{ id: string; name: string; isPersonal: boolean; ownerUserId: string | null }[]>;
}
