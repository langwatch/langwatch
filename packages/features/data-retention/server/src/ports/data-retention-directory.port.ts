/**
 * The organization lineage a retention rule is placed, named and gated against.
 *
 * Three other verticals' rows — organizations, teams and projects — read for
 * one purpose: to say which organization owns a scope target, what a scope is
 * called, and which projects a scope resolves to. They arrive as a port rather
 * than as those verticals' services because this package must not gain an
 * identity graph to print a team's name beside a rule.
 */

/** One retention target: the tier plus the organization, team or project id. */
export type RetentionScopeTarget = Readonly<{
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
}>;

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
  abstract tryGetProjectLineage(input: {
    projectId: string;
  }): Promise<RetentionProjectLineage | null>;

  abstract listOrganizationDirectory(input: {
    organizationId: string;
  }): Promise<RetentionOrganizationDirectory>;

  /**
   * The organization that owns a scope target, or null when the target does
   * not exist.
   *
   * The anchor every gate on a scope-targeted mutation checks against — NOT a
   * caller-supplied project id, which could name a different organization. A
   * caller who manages a scope in a free organization and also holds a paid
   * project elsewhere would otherwise clear the paid-tier gate with the second
   * while writing to the first.
   */
  abstract tryResolveScopeOrganizationId(input: {
    scope: RetentionScopeTarget;
  }): Promise<string | null>;

  /**
   * The live projects one scope resolves to, always enumerated FROM the
   * organization: a foreign team or project id resolves to no rows, which is
   * what stops a wider scope surfacing another tenant's storage.
   *
   * Archived projects are excluded — they are hidden from the nav and every
   * other listing, so counting them would inflate the "N projects" the storage
   * card reports beyond what the reader can actually see.
   */
  abstract listScopeProjects(input: {
    organizationId: string;
    scope: RetentionScopeTarget;
  }): Promise<ReadonlyArray<{ id: string; teamId: string }>>;
}
