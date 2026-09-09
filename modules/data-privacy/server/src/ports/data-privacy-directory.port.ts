import type { DataPrivacyScope } from "@langwatch/data-privacy-contract";

/** A project's place in the organization chain, plus the name it renders under. */
export type DataPrivacyProjectLineage = Readonly<{
  projectId: string;
  name: string;
  teamId: string | null;
  organizationId: string | null;
  organizationName: string | null;
}>;

/** One organization's scope targets, as the settings page lists them. */
export type DataPrivacyOrganizationDirectory = Readonly<{
  /** Archived departments stay in the list so existing rules keep a name. */
  departments: ReadonlyArray<{ id: string; name: string; archived: boolean }>;
  teams: ReadonlyArray<{ id: string; name: string }>;
  projects: ReadonlyArray<{ id: string; name: string; teamId: string }>;
  /** The custom RBAC groups a `restrict` rule may name as its audience. */
  groups: ReadonlyArray<{ id: string; name: string }>;
}>;

/**
 * The organization lineage a privacy rule is placed and named against.
 *
 * Four other verticals' rows — organizations, departments, teams and projects —
 * read for one purpose: to say which organization owns a scope target and what
 * a scope is called. That is why they arrive as a port rather than as those
 * verticals' services: this package must not gain a write graph, an authz
 * service and three identity ports to print a team's name beside a rule.
 */
export abstract class DataPrivacyDirectoryPort {
  /** The project the settings page was opened from, or null when there is none. */
  abstract tryGetProjectLineage(input: {
    projectId: string;
  }): Promise<DataPrivacyProjectLineage | null>;

  abstract listOrganizationDirectory(input: {
    organizationId: string;
  }): Promise<DataPrivacyOrganizationDirectory>;

  /**
   * The organization that owns a scope target, or null when the target does
   * not exist.
   *
   * The anchor every gate on a scope-targeted mutation checks against — NOT a
   * caller-supplied project id, which could name a different organization.
   */
  abstract tryResolveScopeOrganizationId(input: {
    scope: DataPrivacyScope;
  }): Promise<string | null>;
}
