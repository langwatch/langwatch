// Who holds a custom role and where, folded out of the assignments (main's roleHolders.ts).

import type { GrantScopeTier } from "@langwatch/authz-contract";

import type { ManagedGrant } from "./managed-grant.ts";

/** One place a role is in force. */
export type GrantScope = {
  scopeType: GrantScopeTier;
  scopeId: string;
  scopeName: string | null;
};

/** A person, group or API key holding a role, however many assignments that took. */
export type Holder = {
  key: string;
  kind: "person" | "group" | "apiKey";
  userId: string | null;
  name: string;
  image: string | null;
  /** The directory a group is managed by, when it is. */
  directory: string | null;
};

const SCOPE_ORDER: Record<GrantScopeTier, number> = {
  ORGANIZATION: 0,
  TEAM: 1,
  PROJECT: 2,
};

const KIND_ORDER: Record<Holder["kind"], number> = { person: 0, group: 1, apiKey: 2 };

function holderOf(binding: ManagedGrant): Holder {
  const shared = { userId: binding.userId, image: binding.userImage, directory: null };
  if (binding.userId) {
    return {
      ...shared,
      key: `person:${binding.userId}`,
      kind: "person",
      name: binding.userName ?? binding.userEmail ?? "A member with no name yet",
    };
  }
  if (binding.groupId) {
    return {
      ...shared,
      key: `group:${binding.groupId}`,
      kind: "group",
      name: binding.groupName ?? "A group with no name yet",
      directory: binding.groupScimSource,
    };
  }
  if (binding.apiKeyId) {
    return {
      ...shared,
      key: `apiKey:${binding.apiKeyId}`,
      kind: "apiKey",
      name: binding.apiKeyName ?? "An API key with no name yet",
    };
  }
  return {
    ...shared,
    key: `unattributed:${binding.id}`,
    kind: "apiKey",
    name: "An assignment with no holder",
  };
}

/** Everyone holding the role, each once: people first, then groups, then keys. */
export function holdersOfCustomRole({
  assignments,
  customRoleId,
}: {
  assignments: readonly ManagedGrant[];
  customRoleId: string;
}): Holder[] {
  const holders = new Map<string, Holder>();
  for (const binding of assignments) {
    if (binding.customRoleId !== customRoleId) continue;
    const holder = holderOf(binding);
    if (!holders.has(holder.key)) holders.set(holder.key, holder);
  }
  return [...holders.values()].toSorted(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name),
  );
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
  return [...scopes.values()].toSorted(
    (a, b) =>
      SCOPE_ORDER[a.scopeType] - SCOPE_ORDER[b.scopeType] ||
      (a.scopeName ?? "").localeCompare(b.scopeName ?? ""),
  );
}
