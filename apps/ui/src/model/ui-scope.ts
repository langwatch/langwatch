/**
 * The organization graph a scope is resolved against, and what a resolution
 * produces.
 *
 * These are the fields the resolution READS, not the whole record the server
 * returns. `organization.getAll` hands back fully loaded Prisma rows with
 * dozens of columns; naming only what decides a scope keeps the harvested
 * rules honest — a field that appears here is a field some precedence rule
 * consults, and nothing else can quietly start depending on the wire shape.
 *
 * Every optional field is optional because the source makes it so: a team the
 * caller holds no membership row in arrives with `members: []`, and
 * `isPersonal` / `ownerUserId` are nullable columns.
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
  readonly isPersonal?: boolean | null;
  readonly ownerUserId?: string | null;
  /** Narrowed by `organization.getAll` to the caller's own row, when there is one. */
  readonly members?: readonly { readonly userId?: string }[];
  readonly projects: readonly UiScopeProject[];
};

export type UiScopeOrganization = {
  readonly id: string;
  readonly slug?: string;
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
