/**
 * The vocabulary the management REST families share on the wire.
 *
 * A role binding grants a scoped role, and the same three words appear on
 * roles, role bindings, groups, teams and API keys. Declared once here so the
 * CLI's flag parsers validate against one list rather than five copies that
 * can disagree with the platform.
 */

/** The role a binding grants at its scope. `CUSTOM` defers to a custom role. */
export const MANAGEMENT_ROLES = ["ADMIN", "MEMBER", "VIEWER", "CUSTOM"] as const;

export type ManagementRole = (typeof MANAGEMENT_ROLES)[number];

/** Where a binding takes effect. */
export const MANAGEMENT_SCOPE_TYPES = ["ORGANIZATION", "TEAM", "PROJECT"] as const;

export type ManagementScopeType = (typeof MANAGEMENT_SCOPE_TYPES)[number];

/** The role a member holds on the organization itself. */
export const ORGANIZATION_ROLES = ["ADMIN", "MEMBER", "EXTERNAL"] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** One scoped grant, in the shape a write accepts and a read returns. */
export interface ManagementBindingInput {
  role: ManagementRole;
  customRoleId?: string;
  scopeType: ManagementScopeType;
  scopeId: string;
}
