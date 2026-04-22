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

/** Returns the list of standard roles at or below the given role in the hierarchy. */
export function rolesAtOrBelow(
  role: string,
): Array<{ label: string; value: string }> {
  const idx = STANDARD_ROLES.indexOf(
    role as (typeof STANDARD_ROLES)[number],
  );
  if (idx === -1) return [];
  return STANDARD_ROLES.slice(idx).map((r) => ({ label: r, value: r }));
}

export type PermissionMode = "all" | "readonly" | "restricted";

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
      return data.map((b) => {
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

/** One-line summary of a role-binding set for table display. */
export function roleSummary(
  bindings: Array<{
    role: string;
    scopeType: string;
    scopeId: string;
  }>,
): string {
  if (bindings.length === 0) return "No permissions";
  const first = bindings[0]!;
  const scope =
    first.scopeType === "ORGANIZATION"
      ? "Org-wide"
      : first.scopeType === "TEAM"
        ? "Team"
        : "Project";
  const suffix = bindings.length > 1 ? ` +${bindings.length - 1} more` : "";
  return `${first.role} (${scope})${suffix}`;
}
