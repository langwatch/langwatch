/**
 * ADR-092 delivery-plan PR 3 follow-up — the Access surface's read port.
 *
 * Decisions moved onto the ledger's head at cutover
 * (`authz-read.cutover.repository.ts`); this port moves what people SEE. Every
 * settings page that renders access - the bindings table, a member's own
 * breakdown, team member lists, a group's bindings, the API key drawer, the
 * role editor - lists through it, and the cutover-aware implementation serves
 * a cut-over organization from `Grant`/`Role` and everyone else from the
 * legacy `RoleBinding`/`CustomRole` heads, behind the same gate the decision
 * fork reads. A page that renders one head while the engine decides from the
 * other could show access that does not exist or hide access that does.
 *
 * The rows speak the LEGACY vocabulary (`TeamUserRole`,
 * `RoleBindingScopeType`, a `customRole` object) on purpose: it is what every
 * consumer renders today, and the grants head can always translate into it -
 * the fold performs the identical translation onto the compat rows
 * (`grantFactToCompatBinding` in @langwatch/authz-server). Row ids are stable
 * across the heads by construction: an imported grant ADOPTS its binding's
 * row id, and a ledger-born grant's id IS the compat row's id.
 *
 * Dormant facts (lite-member, project-credential, platform grants - delivery
 * plan decision 13) never surface here: the legacy page never carried them,
 * so a cut-over listing that showed them would be a parity break in what
 * people see, not extra honesty.
 */
import type {
  CustomRole,
  Prisma,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type {
  RoleBindingForSynthesis,
  TeamScopedMemberBinding,
} from "~/server/app-layer/role-bindings/repositories/role-binding.repository";

/**
 * One binding as the Access surface renders it: the fact columns plus the
 * principal and role decoration every page needs. Decoration is nullable per
 * principal kind; a consumer reads the arm matching the id that is set.
 *
 * `createdAt` carries the fact's business time. On the legacy head that is
 * the row's own `createdAt`; on the grants head it is the fact's
 * `occurredAt`, which an imported grant backdates to the legacy row's
 * `createdAt` - so the two heads agree on what the column means even where
 * the projection row was written later than the fact occurred.
 */
export type AccessListingBindingRow = {
  id: string;
  organizationId: string;
  userId: string | null;
  groupId: string | null;
  apiKeyId: string | null;
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  createdAt: Date;
  /**
   * When the binding stops granting, or null when it does not - the
   * expiring-grants term (ADR-092). Surfaced so a listing can SHOW the end
   * date somebody set; never filtered on, because a listing that hid elapsed
   * rows would leave an admin unable to see access they need to clean up.
   *
   * Always null on the legacy head: `RoleBinding` has no such column, and an
   * organization still writing through it cannot create an expiring binding
   * in the first place (the writer refuses it).
   */
  expiresAt: Date | null;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  } | null;
  group: { id: string; name: string; scimSource: string | null } | null;
  apiKey: { id: string; name: string } | null;
  customRole: {
    id: string;
    name: string;
    permissions: Prisma.JsonValue;
  } | null;
};

export interface AccessListingRepository {
  /** Every binding naming this user directly, for the user's row on the
   *  Access page. Unfiltered by membership, exactly as the legacy query: the
   *  caller has already scoped the ask to a member. */
  findUserBindings(args: {
    organizationId: string;
    userId: string;
  }): Promise<AccessListingBindingRow[]>;

  /** The organization's whole bindings table. Rows whose principal is no
   *  longer of this organization (a departed member, a foreign group or key)
   *  are dropped, exactly as the legacy query's relation predicates drop
   *  them. */
  findOrganizationBindings(args: {
    organizationId: string;
  }): Promise<AccessListingBindingRow[]>;

  /** The user's own bindings plus the bindings of the groups they belong to,
   *  for the "my access" breakdown. `groupIds` is the caller's resolved
   *  membership - membership itself is not a grant and stays a caller-side
   *  read. */
  findUserAndGroupBindings(args: {
    organizationId: string;
    userId: string;
    groupIds: readonly string[];
  }): Promise<AccessListingBindingRow[]>;

  /** Every binding at the named scopes (a team page's team- and
   *  project-scoped rows), principal-filtered like the whole table. */
  findScopeBindings(args: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeIds: readonly string[];
  }): Promise<AccessListingBindingRow[]>;

  /** One group's bindings, for the group detail page. */
  findGroupBindings(args: {
    organizationId: string;
    groupId: string;
  }): Promise<AccessListingBindingRow[]>;

  /** Direct user members of these teams, shaped for the team-settings member
   *  list. Every requested teamId is present in the map (empty array if
   *  none); a user may appear twice per team (a built-in plus a custom
   *  binding) - callers dedupe. */
  findTeamMemberBindings(args: {
    organizationId: string;
    teamIds: readonly string[];
  }): Promise<Map<string, TeamScopedMemberBinding[]>>;

  /** The user's team- and org-relevant bindings across organizations, direct
   *  or via group, for organization.getAll's team-membership synthesis. */
  findBindingsForSynthesis(args: {
    orgIds: readonly string[];
    userId: string;
  }): Promise<RoleBindingForSynthesis[]>;

  /** The user-created roles of one organization, newest first - the role
   *  editor's list. */
  findUserCreatedRoles(args: { organizationId: string }): Promise<CustomRole[]>;
}

/** Shared select shapes for the principal decoration lookups (user, group,
 *  API key), so the legacy and grants implementations can never drift on
 *  which columns the surface renders. The custom-role select is used by the
 *  legacy side only — the grants side builds the same shape by hand from the
 *  `Role` model, and the paired listing tests are what hold them together. */
export const ACCESS_LISTING_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const satisfies Prisma.UserSelect;

export const ACCESS_LISTING_GROUP_SELECT = {
  id: true,
  name: true,
  scimSource: true,
} as const satisfies Prisma.GroupSelect;

export const ACCESS_LISTING_API_KEY_SELECT = {
  id: true,
  name: true,
} as const satisfies Prisma.ApiKeySelect;

export const ACCESS_LISTING_CUSTOM_ROLE_SELECT = {
  id: true,
  name: true,
  permissions: true,
} as const satisfies Prisma.CustomRoleSelect;
