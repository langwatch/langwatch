/**
 * What an API key may be granted, and what the CALLER may grant it.
 *
 * Moved from `platform/app/src/pages/settings/api-keys/utils.ts` with one
 * substitution: the hierarchy rule and the built-in role bags now come from
 * `@langwatch/authz-contract` rather than from `~/server/api/rbac`, which a
 * browser package may not reach — it is 2,239 lines that reach the engine gate
 * and through it a Node-only logger. Both replacements are the ones the RBAC
 * family made for a whole page and the agents family made for a picker:
 *
 *   - `hasPermissionWithHierarchy(list, p)` → `permissionSatisfiedBy({ granted, requested })`
 *   - `getTeamRolePermissions(role)` → `builtinRolePermissions(roleKeyForTeamRole(role))`
 *
 * THE TWO SETS ARE NOT CHARACTER-IDENTICAL AND IT SHOWS IN EXACTLY ONE PLACE.
 * The contract's `admin` bag lists `langy:create`, `langy:update` and
 * `langy:delete` explicitly where the legacy bag left them to `langy:manage` and
 * the hierarchy rule. Everywhere a bag is read through
 * {@link categoryAccessAvailability} that is invisible, because the rule applies
 * the manage implication either way. The one place it is visible is the CLI
 * key's DEFAULT permission list, which filters `defaultCliKeyPermissions()` by
 * plain set membership: an organization admin's minted key now carries those
 * three strings alongside the `langy:manage` it already carried. The key can do
 * exactly what it could before — manage implies all three at the engine — and
 * `cli-key-defaults.unit.test.ts` pins that reading.
 */

import {
  type AccessLevel,
  categorizablePermissions,
  PERMISSION_CATEGORIES,
  type PermissionCategory,
} from "@langwatch/api-key-contract";
import {
  bindingScopeCanGrantPermission,
  builtinRolePermissions,
  permissionSatisfiedBy,
  roleKeyForTeamRole,
} from "@langwatch/authz-contract";

/** The team-role vocabulary the API key surfaces speak. */
export type ApiKeyTeamRole = "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";

/**
 * Every permission a built-in team role holds.
 *
 * The default `getTeamRolePermissions` for every caller in this package. It is
 * still injectable below, because the ceiling calculations are the part of this
 * family most worth testing in isolation and a test that has to construct a real
 * role bag is testing the contract instead.
 */
export function teamRolePermissions(role: string): string[] {
  return [...builtinRolePermissions(roleKeyForTeamRole(role as ApiKeyTeamRole))];
}

/**
 * Whether the user may hand a category's read or write level to an API key.
 *
 * A level is available when the category declares it, the matching permission
 * array is non-empty, and the user holds every permission in it. The
 * non-empty guard is what keeps a write-only category (project
 * administration) from reading as available: `[].every(...)` is `true`.
 *
 * One copy for both consumers, the category rows and the drawer's
 * select-all — a security-relevant predicate kept in two places drifts.
 */
export function categoryAccessAvailability({
  category,
  userPermissions,
}: {
  category: PermissionCategory;
  userPermissions: string[];
}): { canRead: boolean; canWrite: boolean } {
  const granted = new Set(userPermissions);
  const holdsAll = (permissions: readonly string[]) =>
    permissions.length > 0 &&
    permissions.every((permission) => permissionSatisfiedBy({ granted, requested: permission }));
  return {
    canRead: category.accessLevels.includes("read") && holdsAll(category.readPermissions),
    canWrite: category.accessLevels.includes("write") && holdsAll(category.writePermissions),
  };
}

export type PermissionMode = "all" | "readonly" | "restricted";

export type PermissionLabel = "Read" | "Write";

export const STANDARD_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
  NONE: "None",
};

/** Returns the list of standard roles at or below the given role in the hierarchy, plus "None". */
export function rolesAtOrBelow(role: string): Array<{ label: string; value: string }> {
  const idx = STANDARD_ROLES.indexOf(role as (typeof STANDARD_ROLES)[number]);
  if (idx === -1) return [];
  const roles: Array<{ label: string; value: string }> = STANDARD_ROLES.slice(idx).map((r) => ({
    label: ROLE_LABELS[r] ?? r,
    value: r,
  }));
  roles.push({ label: "None", value: "NONE" });
  return roles;
}

export function roleToPermissionLabel(role: string): PermissionLabel {
  return role === "ADMIN" ? "Write" : "Read";
}

export function permissionLabelToRole(label: PermissionLabel): string {
  return label === "Write" ? "ADMIN" : "VIEWER";
}

type BindingInput = {
  id: string;
  role: string;
  customRoleId: string | null;
  scopeType: string;
  scopeId: string;
};

type BindingOutput = {
  role: string;
  customRoleId: string | null | undefined;
  scopeType: string;
  scopeId: string;
};

/** Computes the effective bindings array based on the selected permission mode. */
export function computeBindings({
  data,
  permissionMode,
  roleOverrides,
}: {
  data: BindingInput[] | undefined;
  permissionMode: PermissionMode;
  roleOverrides: Record<string, string>;
}): BindingOutput[] {
  if (!data) return [];
  switch (permissionMode) {
    case "all":
      return data.map((b) => ({
        role: b.role,
        customRoleId: b.customRoleId,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      }));
    case "readonly":
      return data.map((b) => ({
        role: "VIEWER" as const,
        customRoleId: null,
        scopeType: b.scopeType,
        scopeId: b.scopeId,
      }));
    case "restricted":
      return data
        .filter((b) => (roleOverrides[b.id] ?? b.role) !== "NONE")
        .map((b) => {
          const overriddenRole = roleOverrides[b.id];
          if (overriddenRole && overriddenRole !== b.role) {
            return {
              role: overriddenRole,
              customRoleId: null,
              scopeType: b.scopeType,
              scopeId: b.scopeId,
            };
          }
          return {
            role: b.role,
            customRoleId: b.customRoleId,
            scopeType: b.scopeType,
            scopeId: b.scopeId,
          };
        });
    default: {
      const _exhaustive: never = permissionMode;
      return _exhaustive;
    }
  }
}

function scopeTypeLabel(scopeType: string, count: number): string {
  if (scopeType === "ORGANIZATION") return "Organization";
  if (scopeType === "TEAM") return count === 1 ? "Team" : `${count} Teams`;
  return count === 1 ? "Project" : `${count} Projects`;
}

/** One-line summary of a role-binding set for table display. */
export function roleSummary(
  bindings: Array<{
    role: string;
    scopeType: string;
    scopeId: string;
  }>,
): string {
  if (bindings.length === 0) return "No permissions";

  const counts: Record<string, number> = {};
  for (const b of bindings) {
    counts[b.scopeType] = (counts[b.scopeType] ?? 0) + 1;
  }

  return Object.entries(counts)
    .map(([type, count]) => scopeTypeLabel(type, count))
    .join(", ");
}

export function permissionsSummary({
  permissionMode,
  grantedCount,
  totalCount,
}: {
  permissionMode: string;
  grantedCount: number;
  totalCount: number;
}): string {
  if (permissionMode === "all") return "All";
  return `${grantedCount} of ${totalCount} permissions`;
}

export function findBindingAtScope<T extends { scopeType: string; scopeId: string }>({
  bindings,
  scopeType,
  scopeId,
  organizationId,
  orgProjects,
}: {
  bindings: T[] | undefined;
  scopeType: string;
  scopeId: string;
  organizationId: string;
  orgProjects: Array<{ id: string; teamId: string }>;
}): T | undefined {
  if (!bindings) return undefined;

  const find = (st: string, sid: string) =>
    bindings.find((b) => b.scopeType === st && b.scopeId === sid);

  return (
    find(scopeType, scopeId) ??
    (scopeType === "PROJECT"
      ? find("TEAM", orgProjects.find((p) => p.id === scopeId)?.teamId ?? "")
      : undefined) ??
    (scopeType !== "ORGANIZATION" ? find("ORGANIZATION", organizationId) : undefined)
  );
}

export function deriveBindingRole({
  permissionMode,
  scopeType,
  scopeId,
  myBindings,
  organizationId,
  orgProjects,
  isServiceKey,
}: {
  permissionMode: string;
  scopeType: string;
  scopeId: string;
  myBindings: Array<{ scopeType: string; scopeId: string; role: string }> | undefined;
  organizationId: string;
  orgProjects: Array<{ id: string; teamId: string }>;
  isServiceKey: boolean;
}): string {
  if (permissionMode !== "all") return "CUSTOM";
  if (isServiceKey) return "ADMIN";
  if (!myBindings) return "VIEWER";

  const binding = findBindingAtScope({
    bindings: myBindings,
    scopeType,
    scopeId,
    organizationId,
    orgProjects,
  });

  return binding?.role ?? "VIEWER";
}

export function scopeLabel({
  scopeType,
  scopeName,
}: {
  scopeType: string;
  scopeName?: string;
}): string {
  if (scopeType === "ORGANIZATION") return "Organization";
  const prefix = scopeType === "TEAM" ? "Team" : "Project";
  return scopeName ? `${prefix}: ${scopeName}` : prefix;
}

export function bindingsToScopes(
  roleBindings: Array<{ scopeType: string; scopeId: string }>,
): Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }> {
  return roleBindings.map((rb) => ({
    scopeType: rb.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
    scopeId: rb.scopeId,
  }));
}

export function bindingsToPermissionMode(apiKey: {
  permissionMode: string;
  roleBindings: Array<{ role: string }>;
}): "all" | "restricted" {
  const mode = apiKey.permissionMode as PermissionMode;
  if (mode === "readonly" || mode === "restricted") return "restricted";
  if (apiKey.roleBindings.length === 1 && apiKey.roleBindings[0]!.role === "CUSTOM") {
    return "restricted";
  }
  return "all";
}

export function bindingsToSelections(
  apiKey: {
    permissionMode: string;
    roleBindings: Array<{
      role: string;
      customRoleId: string | null;
      customRolePermissions: string[] | null;
    }>;
  },
  deps: {
    permissionCategories: ReadonlyArray<{
      key: string;
      accessLevels: readonly string[];
    }>;
    selectionsFromPermissions: (perms: string[]) => Record<string, string>;
    getTeamRolePermissions: (role: string) => string[];
  },
): Record<string, string> {
  const mode = apiKey.permissionMode as PermissionMode;

  if (mode === "readonly") {
    const selections: Record<string, string> = {};
    for (const cat of deps.permissionCategories) {
      // Write-only categories (no read level) have nothing to show on a
      // readonly key.
      if (cat.accessLevels.includes("read")) selections[cat.key] = "read";
    }
    return selections;
  }

  const binding = apiKey.roleBindings[0];
  if (!binding) return {};

  if (binding.role === "CUSTOM" && binding.customRoleId) {
    const permissions = binding.customRolePermissions;
    if (Array.isArray(permissions)) {
      return deps.selectionsFromPermissions(permissions);
    }
  }

  if (binding.role === "VIEWER") {
    const selections: Record<string, string> = {};
    for (const cat of deps.permissionCategories) {
      if (cat.accessLevels.includes("read")) selections[cat.key] = "read";
    }
    return selections;
  }

  if (binding.role === "MEMBER") {
    return deps.selectionsFromPermissions(deps.getTeamRolePermissions("MEMBER"));
  }

  const selections: Record<string, string> = {};
  for (const cat of deps.permissionCategories) {
    selections[cat.key] = cat.accessLevels.includes("write") ? "write" : "read";
  }
  return selections;
}

export function getUserPermissionsAtScope({
  myBindings,
  scopeType,
  scopeId,
  organizationId,
  orgProjects,
  isServiceKey,
  getTeamRolePermissions: getRolePerms = teamRolePermissions,
}: {
  myBindings: Array<{ scopeType: string; scopeId: string; role: string }> | undefined;
  scopeType: string;
  scopeId: string;
  organizationId: string;
  orgProjects: Array<{ id: string; teamId: string }>;
  isServiceKey: boolean;
  getTeamRolePermissions?: (role: string) => string[];
}): string[] {
  // Service keys and organization admins can grant anything grantable: the
  // permission resolver short-circuits an ORGANIZATION-scoped ADMIN binding to
  // full access, so the team-role bags (which carry no organization, gateway,
  // governance or playground permissions) understate their ceiling.
  if (isServiceKey) return categorizablePermissions();

  const binding = findBindingAtScope({
    bindings: myBindings,
    scopeType,
    scopeId,
    organizationId,
    orgProjects,
  });
  if (!binding) return [];
  if (binding.scopeType === "ORGANIZATION" && binding.role === "ADMIN") {
    return categorizablePermissions();
  }
  // A non-ADMIN ORGANIZATION-scoped builtin binding grants the org-member bag
  // only (organization:view, aiTools:view) — the resolver's non-ADMIN branch
  // never consults the team-role bags for it. Offering the team bag here made
  // the ceiling overstate what the approve/save endpoints would accept, so a
  // selection built from it was refused wholesale with "exceeds your own
  // access". The bag is further narrowed to what a binding at the REQUESTED
  // scope may carry: both bag permissions are org-exclusive, and the CLI mint
  // strips org-exclusive permissions from any selection with no ORGANIZATION
  // binding (`filterToGrantable`) — a TEAM or PROJECT chip covered only by
  // this fallback therefore has an empty ceiling, not a view-only one that
  // 422s at approval. CUSTOM org bindings resolve their own permission list
  // and keep the injected bag.
  if (binding.scopeType === "ORGANIZATION" && binding.role !== "CUSTOM") {
    return [...builtinRolePermissions("org-member")].filter((permission) =>
      bindingScopeCanGrantPermission({
        scopeType: scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
        permission,
      }),
    );
  }
  return getRolePerms(binding.role);
}

/**
 * The ceiling for a key bound to several scopes at once: the intersection of
 * what the caller holds at each of them.
 *
 * One permission list serves every binding on a key, so a permission held on
 * one team but not on another cannot go out — `assertSelectionWithinCeiling`
 * walks every binding at save time and refuses the whole selection. Offering
 * such a permission would turn a valid-looking form into a scope violation.
 */
export function getUserPermissionsAcrossScopes({
  myBindings,
  scopes,
  organizationId,
  orgProjects,
  isServiceKey,
  getTeamRolePermissions: getRolePerms = teamRolePermissions,
}: {
  myBindings: Array<{ scopeType: string; scopeId: string; role: string }> | undefined;
  scopes: Array<{ scopeType: string; scopeId: string }>;
  organizationId: string;
  orgProjects: Array<{ id: string; teamId: string }>;
  isServiceKey: boolean;
  getTeamRolePermissions?: (role: string) => string[];
}): string[] {
  const perScope = scopes.map(
    (scope) =>
      new Set(
        getUserPermissionsAtScope({
          myBindings,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          organizationId,
          orgProjects,
          isServiceKey,
          getTeamRolePermissions: getRolePerms,
        }),
      ),
  );

  const [first, ...rest] = perScope;
  if (!first) return [];
  return [...first].filter((permission) => rest.every((held) => held.has(permission)));
}

/**
 * Narrows category selections to what the ceiling still allows.
 *
 * The ceiling moves while the form is open: selecting one more scope drops
 * the intersection to what the caller holds everywhere, and a level picked
 * under the wider ceiling would otherwise stay selected and leave the form
 * looking valid until the save comes back `api_key_scope_violation`. Write
 * falls back to read where read survives, and to none where neither does,
 * so the rows the user reads are the permissions that actually go out.
 *
 * A category the ceiling no longer covers renders locked, which is the same
 * `categoryAccessAvailability` answer the rows themselves use.
 */
export function clampSelectionsToAvailability({
  selections,
  userPermissions,
}: {
  selections: Record<string, AccessLevel | "none">;
  userPermissions: string[];
}): Record<string, AccessLevel | "none"> {
  const clamped: Record<string, AccessLevel | "none"> = {};
  for (const [key, level] of Object.entries(selections)) {
    const category = PERMISSION_CATEGORIES.find((c) => c.key === key);
    clamped[key] =
      level === "none" || !category
        ? "none"
        : highestLevelStillGranted({
            level,
            ...categoryAccessAvailability({ category, userPermissions }),
          });
  }
  return clamped;
}

/** Write where write survives, otherwise read, otherwise nothing. */
function highestLevelStillGranted({
  level,
  canRead,
  canWrite,
}: {
  level: AccessLevel;
  canRead: boolean;
  canWrite: boolean;
}): AccessLevel | "none" {
  if (level === "write" && canWrite) return "write";
  if (canRead) return "read";
  return "none";
}
