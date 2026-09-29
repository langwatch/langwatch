/**
 * How the Role Bindings audit reads: one row per principal, every binding
 * they hold beside them. The binding shape is `@langwatch/authz-contract`'s
 * own {@link AuthzManagedOrganizationBinding}, not a browser-inferred router output.
 */

import type { WireOf } from "@langwatch/api/web";
import type {
  AuthzManagedOrganizationBinding,
  RoleBindingScopeType,
} from "@langwatch/authz-contract";

/** A binding as the browser holds one: the wire carries `createdAt` as a string. */
export type RoleBinding = WireOf<AuthzManagedOrganizationBinding>;

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
  apiKeyId: string | null;
  apiKeyName: string | null;
  bindings: RoleBinding[];
};

/**
 * The bindings this filter admits. `ALL` is not a tier, so it is the only
 * value that admits every row; every other value is compared to the row's
 * own tier.
 */
export function bindingsInFilter(
  bindings: readonly RoleBinding[],
  filter: BindingScopeFilter,
): RoleBinding[] {
  return filter === "ALL"
    ? [...bindings]
    : bindings.filter((binding) => binding.scopeType === filter);
}

/** How many bindings sit at each tier, counted across all of them for the filter chips. */
export function scopeCounts(bindings: readonly RoleBinding[]): Record<BindingScopeFilter, number> {
  const count = (filter: BindingScopeFilter) => bindingsInFilter(bindings, filter).length;
  return {
    ALL: count("ALL"),
    ORGANIZATION: count("ORGANIZATION"),
    TEAM: count("TEAM"),
    PROJECT: count("PROJECT"),
  };
}

/**
 * One row per principal, ordered by the name a reader sees. An API key is a
 * principal of its own; a binding naming no holder at all keeps a row of its
 * own rather than piling onto its siblings, so every binding stays countable.
 */
export function groupBindingsByPrincipal(bindings: readonly RoleBinding[]): BindingPrincipal[] {
  const byKey = new Map<string, BindingPrincipal>();

  for (const binding of bindings) {
    const key =
      binding.userId ?? binding.groupId ?? binding.apiKeyId ?? `unattributed:${binding.id}`;
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
        apiKeyId: binding.apiKeyId,
        apiKeyName: binding.apiKeyName,
        bindings: [],
      };
      byKey.set(key, principal);
    }
    principal.bindings.push(binding);
  }

  return [...byKey.values()].toSorted((left, right) =>
    principalDisplayName(left).localeCompare(principalDisplayName(right)),
  );
}

function principalDisplayName(principal: BindingPrincipal): string {
  return (
    principal.userName ?? principal.groupName ?? principal.apiKeyName ?? principal.userEmail ?? ""
  );
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
