/**
 * How a grant list reads a grant and which roles the grant dialog offers.
 * The server's escalation guard is the authority; the hints here only grey out
 * a role the reader plainly cannot hand on. specs/rbac/roles-and-access-ui.feature
 */

import { permissionSatisfiedBy } from "@langwatch/authorization";
import {
  builtinRolePermissions,
  type BuiltInRoleId,
  type Grant,
  type GrantScopeType,
} from "@langwatch/authz-contract";
import { currentTimeZone, type Instant, Temporal } from "@langwatch/time";

/** A grant as the browser holds one: the wire carries its dates as strings. */
export type GrantRow = Omit<Grant, "expiresAt" | "createdAt"> & {
  expiresAt: string | null;
  createdAt: string;
};

export type GrantRoleOption = { id: string; name: string; builtIn: boolean };

const BUILT_IN_ROLES: readonly (GrantRoleOption & { id: BuiltInRoleId })[] = [
  { id: "admin", name: "Admin", builtIn: true },
  { id: "member", name: "Member", builtIn: true },
  { id: "viewer", name: "Viewer", builtIn: true },
];

/** The built-in roles first, always and once, then the organization's own. */
export function grantRoleOptions({
  customRoles,
}: {
  customRoles: readonly { id: string; name: string }[];
}): GrantRoleOption[] {
  const custom = customRoles.filter((role) => !BUILT_IN_ROLES.some(({ id }) => id === role.id));

  return [
    ...BUILT_IN_ROLES,
    ...custom.map((role) => ({ id: role.id, name: role.name, builtIn: false })),
  ];
}

/**
 * What a role confers at a scope, read as the server's rule reads it, or null when
 * the browser cannot say: a built-in role on the organization confers organization-wide
 * permissions the page does not hold a list of.
 */
export function rolePermissionsAt({
  roleId,
  scopeType,
  customRoles,
}: {
  roleId: string;
  scopeType: GrantScopeType;
  customRoles: readonly { id: string; permissions: readonly string[] }[];
}): readonly string[] | null {
  const builtIn = BUILT_IN_ROLES.find((role) => role.id === roleId);
  if (!builtIn) return customRoles.find((role) => role.id === roleId)?.permissions ?? null;
  if (scopeType === "organization") return null;

  return [...builtinRolePermissions(builtIn.id)];
}

/** The permissions the reader lacks to hand on, `manage` implying its actions. */
export function permissionsBeyondReader({
  requested,
  held,
}: {
  requested: readonly string[];
  held: readonly string[];
}): string[] {
  const granted = new Set(held);

  return requested.filter(
    (permission) => !permissionSatisfiedBy({ granted, requested: permission }),
  );
}

const SCOPE_LABEL: Readonly<Record<GrantScopeType, string>> = {
  organization: "Organization",
  team: "Team",
  project: "Project",
};

export function grantScopeText(scope: GrantRow["scope"]): string {
  return `${SCOPE_LABEL[scope.type]} · ${scope.name ?? scope.id}`;
}

export function grantPrincipalText(principal: GrantRow["principal"]): string {
  if (principal.name) return principal.name;
  if (principal.type === "group") return "Unknown group";
  if (principal.type === "apiKey") return "An API key with no name yet";

  return "Unknown member";
}

/** A picked calendar day, granting until the end of it; empty means it never ends. */
export function expiryFromDay(day: string): Instant | undefined {
  if (!day) return void 0;

  return Temporal.PlainDate.from(day)
    .toZonedDateTime({ timeZone: currentTimeZone(), plainTime: "23:59:59" })
    .toInstant();
}
