/**
 * The organization graph a scope is resolved against — only the fields
 * the resolution READS, not the whole Prisma row `organization.getAll`
 * returns, so nothing can quietly depend on the wire shape.
 */

/** The reserved top-level addresses that also bind the `:project` segment. */
export const UI_RESERVED_PROJECT_SLUGS: readonly string[] = [
  "analytics",
  "datasets",
  "evaluations",
  "experiments",
  "messages",
];

/** The organization role that opens every team of its organization. */
export const UI_ORGANIZATION_ADMIN_ROLE = "ADMIN";

export type UiScopeProject = {
  readonly id: string;
  readonly slug: string;
  readonly name?: string;
};

export type UiScopeTeam = {
  readonly id: string;
  readonly slug: string;
  /** Read by a screen that names a team, never by the resolution. */
  readonly name?: string;
  readonly isPersonal?: boolean | null;
  readonly ownerUserId?: string | null;
  /** Narrowed by `organization.getAll` to the caller's own row, when there is one. */
  readonly members?: readonly { readonly userId?: string }[];
  readonly projects: readonly UiScopeProject[];
};

export type UiScopeOrganization = {
  readonly id: string;
  readonly slug?: string;
  /** Read by a screen that names an organization, never by the resolution. */
  readonly name?: string;
  /** Narrowed by `organization.getAll` to the caller's own row. */
  readonly members?: readonly { readonly role: string }[];
  readonly teams: readonly UiScopeTeam[];
};

/** What the address bar says about the scope, once the router has matched. */
export type UiScopeRoute = {
  /** The `:project` segment, reserved slugs included — the raw value. */
  readonly projectParam?: string;
  /** The `?team=` query parameter. */
  readonly teamParam?: string;
  /**
   * The personal workspace's own pages. Read off the matched route rather than
   * the raw path: `/me/traces` is a project named "me", not a personal page.
   */
  readonly isPersonalScopeRoute: boolean;
};

/** The selection a previous page left behind, as stored. */
export type UiScopeSelection = {
  readonly organizationId: string;
  readonly teamId: string;
  readonly projectSlug: string;
};

/** The organization, team and project one page is about. */
export type UiResolvedScope = {
  readonly organization?: UiScopeOrganization;
  readonly team?: UiScopeTeam;
  readonly project?: UiScopeProject;
  /** The organization role of the caller, or undefined outside one. */
  readonly organizationRole?: string;
  /** Whether this page is the public demo project. */
  readonly isDemo: boolean;
};
