/**
 * What an API key may be granted, and what the CALLER may grant it, per
 * `@langwatch/authz-contract` — its `admin` bag lists `langy:create/update/delete`
 * explicitly where the legacy bag implied them; see `cli-key-defaults.unit.test.ts`.
 */

import {
  type AccessLevel,
  type ApiKeyRole,
  PERMISSION_CATEGORIES,
  type PermissionCategory,
} from "@langwatch/api-key-contract";
import { permissionSatisfiedBy } from "@langwatch/authorization";
import { builtinRolePermissions, roleKeyForTeamRole } from "@langwatch/authz-contract";

/** The team-role vocabulary the API key surfaces speak. */
export type ApiKeyTeamRole = "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";

/**
 * Every permission a built-in team role holds. Injectable below, because the
 * ceiling calculations are the part of this family most worth testing in
 * isolation.
 */
export function teamRolePermissions(role: string): string[] {
  return [...builtinRolePermissions(roleKeyForTeamRole(role as ApiKeyTeamRole))];
}

/**
 * Whether the user may hand a category's read or write level to an API key.
 * The non-empty guard keeps a write-only category (project administration)
 * from reading as available: `[].every(...)` is `true`.
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
  orgProjects: { id: string; teamId: string }[];
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
  myBindings: { scopeType: string; scopeId: string; role: ApiKeyRole }[] | undefined;
  organizationId: string;
  orgProjects: { id: string; teamId: string }[];
  isServiceKey: boolean;
}): ApiKeyRole {
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
  grants: { scopeType: string; scopeId: string }[],
): { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[] {
  return grants.map((rb) => ({
    scopeType: rb.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
    scopeId: rb.scopeId,
  }));
}

export function bindingsToPermissionMode(apiKey: {
  permissionMode: string;
  grants: { role: string }[];
}): "all" | "restricted" {
  const mode = apiKey.permissionMode as PermissionMode;
  if (mode === "readonly" || mode === "restricted") return "restricted";
  const [onlyBinding] = apiKey.grants;
  const hasSingleCustomBinding = apiKey.grants.length === 1 && onlyBinding?.role === "CUSTOM";
  if (hasSingleCustomBinding) {
    return "restricted";
  }
  return "all";
}

export function bindingsToSelections(
  apiKey: {
    permissionMode: string;
    grants: {
      role: string;
      customRoleId: string | null;
      customRolePermissions: string[] | null;
    }[];
  },
  deps: {
    permissionCategories: readonly {
      key: string;
      accessLevels: readonly string[];
    }[];
    selectionsFromPermissions: (perms: string[]) => Record<string, string>;
    getTeamRolePermissions: (role: string) => string[];
  },
): Record<string, string> {
  const mode = apiKey.permissionMode as PermissionMode;

  if (mode === "readonly") return readSelections(deps.permissionCategories);

  const binding = apiKey.grants[0];
  if (!binding) return {};

  if (binding.role === "CUSTOM" && binding.customRoleId) {
    const permissions = binding.customRolePermissions;
    if (Array.isArray(permissions)) {
      return deps.selectionsFromPermissions(permissions);
    }
  }

  if (binding.role === "VIEWER") return readSelections(deps.permissionCategories);

  if (binding.role === "MEMBER") {
    return deps.selectionsFromPermissions(deps.getTeamRolePermissions("MEMBER"));
  }

  return fullAccessSelections(deps.permissionCategories);
}

type PermissionCategoryLevels = { key: string; accessLevels: readonly string[] };

/** Read on every category that has a read level; write-only categories show nothing. */
function readSelections(categories: readonly PermissionCategoryLevels[]): Record<string, string> {
  const selections: Record<string, string> = {};
  for (const cat of categories) {
    if (cat.accessLevels.includes("read")) selections[cat.key] = "read";
  }
  return selections;
}

/** The broadest level on every category: write where it exists, else read. */
function fullAccessSelections(
  categories: readonly PermissionCategoryLevels[],
): Record<string, string> {
  const selections: Record<string, string> = {};
  for (const cat of categories) {
    selections[cat.key] = cat.accessLevels.includes("write") ? "write" : "read";
  }
  return selections;
}

/**
 * Narrows category selections to what the moving ceiling still allows:
 * write falls back to read where read survives, else to none. A category
 * no longer covered renders locked, per `categoryAccessAvailability`.
 */
export function clampSelectionsToAvailability({
  selections,
  userPermissions,
  categories = PERMISSION_CATEGORIES,
}: {
  selections: Record<string, AccessLevel | "none">;
  userPermissions: string[];
  /** The categories the selections speak; the CLI approval passes `cliPermissionCategories()`. */
  categories?: readonly PermissionCategory[];
}): Record<string, AccessLevel | "none"> {
  const clamped: Record<string, AccessLevel | "none"> = {};
  for (const [key, level] of Object.entries(selections)) {
    const category = categories.find((c) => c.key === key);
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
