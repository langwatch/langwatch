/**
 * The organization lineage a retention rule is placed, named and gated against.
 * A port rather than this feature's own repositories: `Organization`, `Team` and
 * `Project` belong to other features, and a repository here would claim them.
 */

import type { ScopeAssignment } from "@langwatch/data-retention-contract";

/** A project's place in the organization chain, plus the name it renders under. */
export type RetentionProjectLineage = Readonly<{
  projectId: string;
  name: string;
  teamId: string | null;
  organizationId: string | null;
  organizationName: string | null;
}>;

/** One organization's scope targets, as the settings page lists them. */
export type RetentionOrganizationDirectory = Readonly<{
  teams: ReadonlyArray<{ id: string; name: string }>;
  /**
   * Archived projects stay in the list so an existing rule that targets one
   * still resolves a NAME; the picker drops them, which is a filter the
   * snapshot applies rather than one this read makes.
   */
  projects: ReadonlyArray<{ id: string; name: string; teamId: string; archived: boolean }>;
}>;

export abstract class DataRetentionDirectoryPort {
  /** The project the settings page was opened from, or null when there is none. */
  abstract findProjectLineage(input: {
    projectId: string;
  }): Promise<RetentionProjectLineage | null>;

  abstract listOrganizationDirectory(input: {
    organizationId: string;
  }): Promise<RetentionOrganizationDirectory>;

  /**
   * The organization that owns a scope target, or null when it does not exist.
   * The anchor every scope-targeted gate checks against — never a
   * caller-supplied project id, which can name a different organization.
   */
  abstract findScopeOrganizationId(input: { scope: ScopeAssignment }): Promise<string | null>;

  /**
   * The live projects one scope resolves to, enumerated FROM the organization
   * so a foreign id resolves to no rows. Archived projects are excluded: the
   * storage card must not count what the reader cannot see.
   */
  abstract listScopeProjects(input: {
    organizationId: string;
    scope: ScopeAssignment;
  }): Promise<ReadonlyArray<{ id: string; teamId: string }>>;
}
