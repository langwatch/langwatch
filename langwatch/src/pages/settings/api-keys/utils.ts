import { createListCollection } from "@chakra-ui/react";

export const EXPIRATION_OPTIONS = [
  { label: "No expiration", value: "" },
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "90 days", value: "90" },
  { label: "Custom...", value: "custom" },
];

export const expirationCollection = createListCollection({
  items: EXPIRATION_OPTIONS,
});

/** Mask the middle of a secret string for display. */
export function maskSecret(v: string): string {
  if (v.length <= 8) return "********";
  return `${v.slice(0, 4)}${"*".repeat(Math.min(v.length - 8, 32))}${v.slice(-4)}`;
}

/** Build a `.env` snippet from key/value entries. */
export function formatEnvLines(
  entries: Array<{ key: string; value: string; mask?: boolean }>,
): string {
  return entries
    .map(
      ({ key, value, mask }) => `${key}="${mask ? maskSecret(value) : value}"`,
    )
    .join("\n");
}

export const STANDARD_ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
  NONE: "None",
};

/** Returns the list of standard roles at or below the given role in the hierarchy, plus "None". */
export function rolesAtOrBelow(
  role: string,
): Array<{ label: string; value: string }> {
  const idx = STANDARD_ROLES.indexOf(
    role as (typeof STANDARD_ROLES)[number],
  );
  if (idx === -1) return [];
  const roles: Array<{ label: string; value: string }> =
    STANDARD_ROLES.slice(idx).map((r) => ({
      label: ROLE_LABELS[r] ?? r,
      value: r,
    }));
  roles.push({ label: "None", value: "NONE" });
  return roles;
}

export type PermissionMode = "all" | "readonly" | "restricted";

export type PermissionLabel = "Read" | "Write";

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

export function findBindingAtScope<
  T extends { scopeType: string; scopeId: string },
>({
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
      ? find(
          "TEAM",
          orgProjects.find((p) => p.id === scopeId)?.teamId ?? "",
        )
      : undefined) ??
    (scopeType !== "ORGANIZATION"
      ? find("ORGANIZATION", organizationId)
      : undefined)
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

export function bindingsToPermissionMode(
  apiKey: {
    permissionMode: string;
    roleBindings: Array<{ role: string }>;
  },
): "all" | "restricted" {
  const mode = apiKey.permissionMode as PermissionMode;
  if (mode === "readonly" || mode === "restricted") return "restricted";
  if (
    apiKey.roleBindings.length === 1 &&
    apiKey.roleBindings[0]!.role === "CUSTOM"
  ) {
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
      selections[cat.key] = "read";
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
      selections[cat.key] = "read";
    }
    return selections;
  }

  if (binding.role === "MEMBER") {
    return deps.selectionsFromPermissions(
      deps.getTeamRolePermissions("MEMBER"),
    );
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
  getTeamRolePermissions: getRolePerms,
}: {
  myBindings: Array<{ scopeType: string; scopeId: string; role: string }> | undefined;
  scopeType: string;
  scopeId: string;
  organizationId: string;
  orgProjects: Array<{ id: string; teamId: string }>;
  isServiceKey: boolean;
  getTeamRolePermissions: (role: string) => string[];
}): string[] {
  if (isServiceKey) return getRolePerms("ADMIN");

  const binding = findBindingAtScope({ bindings: myBindings, scopeType, scopeId, organizationId, orgProjects });
  if (!binding) return [];
  return getRolePerms(binding.role);
}
