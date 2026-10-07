// Who holds what, folded out of the assignments (main's roleHolders.ts): onto the
// holder, then onto the role with the scopes it was granted on. Every kind of holder
// gets its own key and its own word, so no row is ever nameless.

import type { GrantScopeTier } from "@langwatch/authz-contract";

import type { ManagedGrant } from "./managed-grant.ts";

/** One place a role is in force. */
export type GrantScope = {
  scopeType: GrantScopeTier;
  scopeId: string;
  scopeName: string | null;
};

/** One role, and everywhere this holder was granted it. */
export type CollapsedGrant = {
  key: string;
  roleName: string;
  /** Which tier's colour the role badge takes; a custom role is its own tier. */
  tier: string;
  customRoleId: string | null;
  scopes: GrantScope[];
};

/** A person, group or API key holding a role, however many assignments that took. */
export type Holder = {
  key: string;
  kind: "person" | "group" | "apiKey";
  userId: string | null;
  /** Never empty: a holder we cannot name is named as such. */
  name: string;
  address: string | null;
  image: string | null;
  /** The directory a group is managed by, when it is. */
  directory: string | null;
  grants: CollapsedGrant[];
  assignmentCount: number;
};

/** The filter above the Access list: every assignment, then each scope tier. */
export type ScopeCounts = Record<"ALL" | GrantScopeTier, number>;

const SCOPE_ORDER: Record<GrantScopeTier, number> = {
  ORGANIZATION: 0,
  TEAM: 1,
  PROJECT: 2,
};

const KIND_ORDER: Record<Holder["kind"], number> = { person: 0, group: 1, apiKey: 2 };

type HolderIdentity = Pick<Holder, "key" | "kind" | "name" | "address">;

function holderIdentity(binding: ManagedGrant): HolderIdentity {
  if (binding.userId) {
    return {
      key: `person:${binding.userId}`,
      kind: "person",
      name: binding.userName ?? binding.userEmail ?? "A member with no name yet",
      address: binding.userEmail,
    };
  }
  if (binding.groupId) {
    return {
      key: `group:${binding.groupId}`,
      kind: "group",
      name: binding.groupName ?? "A group with no name yet",
      address: null,
    };
  }
  if (binding.apiKeyId) {
    return {
      key: `apiKey:${binding.apiKeyId}`,
      kind: "apiKey",
      name: binding.apiKeyName ?? "An API key with no name yet",
      address: null,
    };
  }
  // One row per unattributed assignment, so it stays countable rather than pooled.
  return {
    key: `unattributed:${binding.id}`,
    kind: "person",
    name: "An assignment with no holder",
    address: null,
  };
}

function byScope(a: GrantScope, b: GrantScope): number {
  return (
    SCOPE_ORDER[a.scopeType] - SCOPE_ORDER[b.scopeType] ||
    (a.scopeName ?? "").localeCompare(b.scopeName ?? "")
  );
}

function collapseGrants(bindings: readonly ManagedGrant[]): CollapsedGrant[] {
  const byRole = new Map<string, CollapsedGrant>();
  for (const binding of bindings) {
    const key = binding.customRoleId ?? binding.role;
    let grant = byRole.get(key);
    if (!grant) {
      grant = {
        key,
        roleName: binding.customRoleName ?? binding.role,
        tier: binding.customRoleId ? "CUSTOM" : binding.role,
        customRoleId: binding.customRoleId,
        scopes: [],
      };
      byRole.set(key, grant);
    }
    if (!grant.scopes.some((scope) => scope.scopeId === binding.scopeId)) {
      grant.scopes.push({
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
        scopeName: binding.scopeName,
      });
    }
  }
  return [...byRole.values()]
    .map((grant) => ({ ...grant, scopes: grant.scopes.toSorted(byScope) }))
    .toSorted((a, b) => a.roleName.localeCompare(b.roleName));
}

/** One holder per person, group or key: people first, then groups, then keys. */
export function holdersOf(assignments: readonly ManagedGrant[]): Holder[] {
  const byHolder = new Map<string, { first: ManagedGrant; rows: ManagedGrant[] }>();
  for (const binding of assignments) {
    const { key } = holderIdentity(binding);
    const entry = byHolder.get(key);
    if (entry) entry.rows.push(binding);
    else byHolder.set(key, { first: binding, rows: [binding] });
  }

  const holders = [...byHolder.values()].map(({ first, rows }) => ({
    ...holderIdentity(first),
    userId: first.userId,
    image: first.userImage,
    directory: first.groupScimSource,
    grants: collapseGrants(rows),
    assignmentCount: rows.length,
  }));
  return holders.toSorted(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name),
  );
}

function plural({ count, word }: { count: number; word: string }): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "Organization, and 3 teams": where a grant applies, when its scopes outgrow a row. */
export function summariseScopes(scopes: readonly GrantScope[]): string {
  const teams = scopes.filter((scope) => scope.scopeType === "TEAM").length;
  const projects = scopes.filter((scope) => scope.scopeType === "PROJECT").length;
  const organization = scopes.some((scope) => scope.scopeType === "ORGANIZATION");

  const parts: string[] = [];
  if (organization) parts.push("Organization");
  if (teams > 0) parts.push(plural({ count: teams, word: "team" }));
  if (projects > 0) parts.push(plural({ count: projects, word: "project" }));

  if (parts.length === 0) return "Nowhere";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

/** Everyone holding the role, each once: people first, then groups, then keys. */
export function holdersOfCustomRole({
  assignments,
  customRoleId,
}: {
  assignments: readonly ManagedGrant[];
  customRoleId: string;
}): Holder[] {
  return holdersOf(assignments.filter((binding) => binding.customRoleId === customRoleId));
}

/** The people holding the role, directly or through a group, each counted once. */
export function peopleHoldingCustomRole({
  assignments,
  customRoleId,
}: {
  assignments: readonly ManagedGrant[];
  customRoleId: string;
}): number {
  const people = new Set<string>();
  for (const binding of assignments) {
    if (binding.customRoleId !== customRoleId) continue;
    if (binding.userId) people.add(binding.userId);
    for (const memberId of binding.memberUserIds) people.add(memberId);
  }
  return people.size;
}

/** Each place the role is in force, once, widest first. */
export function scopesOfCustomRole({
  assignments,
  customRoleId,
}: {
  assignments: readonly ManagedGrant[];
  customRoleId: string;
}): GrantScope[] {
  const scopes = new Map<string, GrantScope>();
  for (const binding of assignments) {
    if (binding.customRoleId !== customRoleId) continue;
    scopes.set(binding.scopeId, {
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
      scopeName: binding.scopeName,
    });
  }
  return [...scopes.values()].toSorted(byScope);
}

/** How many assignments sit at each scope, counted across all of them, not the filter. */
export function scopeCounts(assignments: readonly ManagedGrant[]): ScopeCounts {
  const count = (tier: GrantScopeTier) =>
    assignments.filter((binding) => binding.scopeType === tier).length;
  return {
    ALL: assignments.length,
    ORGANIZATION: count("ORGANIZATION"),
    TEAM: count("TEAM"),
    PROJECT: count("PROJECT"),
  };
}
