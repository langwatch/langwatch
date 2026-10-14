/** Where one project sits: its team as project's row names it, that team's organisation. */
export type DataRetentionProjectPlacement = Readonly<{
  projectId: string;
  organizationId: string;
  teamId: string;
  /** Project's `kind`; absent reads as an application project. */
  kind?: string | undefined;
}>;

/**
 * Project placement read through project's `Project` and organization's `Team` shares (round 46
 * E1, R40): no copy, so an existing project resolves on the first request after a deploy. An
 * archived project keeps its place, so its stored data still expires under the rules.
 */
export abstract class DataRetentionProjectScopeRepository {
  abstract findProjectPlacement(input: {
    projectId: string;
  }): Promise<DataRetentionProjectPlacement | null>;
  /** The organisation a team sits in, archived teams included; null when no team has the id. */
  abstract findTeamOrganizationId(input: { teamId: string }): Promise<string | null>;
  /** Every project under the organisation, or under one team of it; archived included. */
  abstract findProjectIds(input: { organizationId: string; teamId?: string }): Promise<string[]>;
}
