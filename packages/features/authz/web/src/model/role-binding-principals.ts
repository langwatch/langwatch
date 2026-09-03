/**
 * How the Role Bindings audit reads: one row per principal, every binding they
 * hold beside them.
 *
 * The page's whole job is answering "who can do what, and where" for an
 * organization, and a principal with four bindings is one person to a reader
 * even though it is four rows on the wire. The grouping, the ordering and the
 * three vocabularies below were inline in
 * `platform/app/src/pages/settings/role-bindings.tsx`; they are values, so they
 * live here and the screen renders them.
 *
 * THE BINDING SHAPE IS THE CONTRACT'S OWN. `RouterOutputs["roleBinding"]["listForOrg"][number]`
 * was an inference off the application's composed router, which a browser
 * package may not name. It did not need a new declaration: the procedure is
 * mounted from `@langwatch/role-server`, whose handler answers
 * `AuthzListManagedBindingsForOrganizationOutput` — the shape
 * `@langwatch/authz-contract` already declares as
 * {@link AuthzManagedOrganizationBinding}. So this is a REAL repoint onto an
 * existing declaration rather than a restatement, and both halves are now
 * checked against one statement of the row.
 */

import type {
  AuthzManagedOrganizationBinding,
  RoleBindingScopeType,
} from "@langwatch/authz-contract";

export type RoleBinding = AuthzManagedOrganizationBinding;

/** Which scope tier the reader is looking at, or all of them. */
export type BindingScopeFilter = "ALL" | RoleBindingScopeType;

/** One person or group, with everything they hold. */
export type BindingPrincipal = {
  key: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userImage: string | null;
  groupId: string | null;
  groupName: string | null;
  groupScimSource: string | null;
  bindings: RoleBinding[];
};

/**
 * The bindings this filter admits.
 *
 * `ALL` is not a tier, so it is the only value that admits every row; every
 * other value is compared to the row's own tier.
 */
export function bindingsInFilter(
  bindings: readonly RoleBinding[],
  filter: BindingScopeFilter,
): RoleBinding[] {
  return filter === "ALL"
    ? [...bindings]
    : bindings.filter((binding) => binding.scopeType === filter);
}

/**
 * One row per principal, ordered by the name a reader sees.
 *
 * A binding with neither a user nor a group is an API key's, and those collapse
 * onto one `"unknown"` row rather than being dropped — the audit's promise is
 * that every binding in the organization appears somewhere on it.
 */
export function groupBindingsByPrincipal(bindings: readonly RoleBinding[]): BindingPrincipal[] {
  const byKey = new Map<string, BindingPrincipal>();

  for (const binding of bindings) {
    const key = binding.userId ?? binding.groupId ?? "unknown";
    let principal = byKey.get(key);
    if (!principal) {
      principal = {
        key,
        userId: binding.userId,
        userName: binding.userName,
        userEmail: binding.userEmail,
        userImage: binding.userImage,
        groupId: binding.groupId,
        groupName: binding.groupName,
        groupScimSource: binding.groupScimSource,
        bindings: [],
      };
      byKey.set(key, principal);
    }
    principal.bindings.push(binding);
  }

  return [...byKey.values()].sort((left, right) =>
    principalDisplayName(left).localeCompare(principalDisplayName(right)),
  );
}

function principalDisplayName(principal: BindingPrincipal): string {
  return principal.userName ?? principal.groupName ?? principal.userEmail ?? "";
}

/** The palette a role badge takes. Anything that is not built in is a custom role. */
export function roleBadgePalette(role: string): string {
  if (role === "ADMIN") return "red";
  if (role === "MEMBER") return "blue";
  if (role === "VIEWER") return "gray";
  return "purple";
}

/** The palette a scope pill takes. */
export function scopePalette(scopeType: RoleBindingScopeType): string {
  if (scopeType === "ORGANIZATION") return "orange";
  if (scopeType === "TEAM") return "teal";
  return "purple";
}

/** What a scope tier is called on a pill, where the space is one word wide. */
export function scopeLabel(scopeType: RoleBindingScopeType): string {
  if (scopeType === "ORGANIZATION") return "Org";
  if (scopeType === "TEAM") return "Team";
  return "Project";
}

/** What a scope pill says: the tier, then the scope's name or a short id. */
export function scopePillText(binding: RoleBinding): string {
  return `${scopeLabel(binding.scopeType)} · ${binding.scopeName ?? `${binding.scopeId.slice(0, 8)}…`}`;
}
