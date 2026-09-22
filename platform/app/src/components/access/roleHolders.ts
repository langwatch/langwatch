/**
 * Who holds what, worked out from the assignments themselves.
 *
 * The assignments read returns one row per grant, and a real organization has
 * a great many of them: an administrator on the organization and on each of
 * six teams is seven rows that all say the same thing. Listed one per line
 * that is a wall the reader cannot count, let alone act on. So the rows are
 * folded twice before anything is drawn — once onto the person or group that
 * holds them, and once onto the role, carrying the scopes it was granted on.
 *
 * The other job here is that nobody is ever nameless. An assignment can belong
 * to a person, to a group, or to an API key, and the last of those has neither
 * a user nor a group on it. Keyed on "the user, or the group, or nothing", all
 * of an organization's API keys collapse into a single unnamed row holding
 * every one of their grants — which is the wall, wearing no name. Each kind of
 * holder gets its own key and its own word here, and a holder we cannot name
 * says so in a full sentence rather than leaving a blank the reader will read
 * as "still loading".
 */

export type AssignmentScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

export interface AssignmentRow {
  id: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userImage: string | null;
  groupId: string | null;
  groupName: string | null;
  groupScimSource: string | null;
  apiKeyId: string | null;
  apiKeyName: string | null;
  role: string;
  customRoleId: string | null;
  customRoleName: string | null;
  scopeType: AssignmentScopeType;
  scopeId: string;
  scopeName: string | null;
  memberUserIds?: string[];
}

export type HolderKind = "person" | "group" | "apiKey";

export interface GrantScope {
  scopeType: AssignmentScopeType;
  scopeId: string;
  scopeName: string | null;
}

/** One role, and everywhere this holder was granted it. */
export interface CollapsedGrant {
  key: string;
  roleName: string;
  tier: string;
  customRoleId: string | null;
  scopes: GrantScope[];
}

export interface Holder {
  key: string;
  kind: HolderKind;
  userId: string | null;
  /** Never empty: a holder we cannot name is named as such. */
  name: string;
  address: string | null;
  image: string | null;
  /** The directory that owns this group, when one does. */
  directory: string | null;
  grants: CollapsedGrant[];
  assignmentCount: number;
}

const SCOPE_ORDER: Record<AssignmentScopeType, number> = {
  ORGANIZATION: 0,
  TEAM: 1,
  PROJECT: 2,
};

export function roleNameOf(assignment: AssignmentRow): string {
  return assignment.customRoleName ?? assignment.role;
}

/** Which tier's colour a role badge takes. Custom roles are their own tier. */
export function roleTier(assignment: AssignmentRow): string {
  return assignment.customRoleId ? "CUSTOM" : assignment.role;
}

function holderIdentity(assignment: AssignmentRow): {
  key: string;
  kind: HolderKind;
  name: string;
  address: string | null;
} {
  if (assignment.userId) {
    return {
      key: `person:${assignment.userId}`,
      kind: "person",
      name:
        assignment.userName ??
        assignment.userEmail ??
        "A member with no name yet",
      address: assignment.userEmail,
    };
  }
  if (assignment.groupId) {
    return {
      key: `group:${assignment.groupId}`,
      kind: "group",
      name: assignment.groupName ?? "A group with no name yet",
      address: null,
    };
  }
  if (assignment.apiKeyId) {
    return {
      key: `apiKey:${assignment.apiKeyId}`,
      kind: "apiKey",
      name: assignment.apiKeyName ?? "An API key with no name yet",
      address: null,
    };
  }
  // Nothing to key on. One row per assignment rather than one shared pile, so
  // an unexplained grant stays countable instead of hiding behind its siblings.
  return {
    key: `unattributed:${assignment.id}`,
    kind: "apiKey",
    name: "An assignment with no holder",
    address: null,
  };
}

function collapseGrants(assignments: AssignmentRow[]): CollapsedGrant[] {
  const byRole = new Map<string, CollapsedGrant>();

  for (const assignment of assignments) {
    const key = assignment.customRoleId ?? assignment.role;
    let grant = byRole.get(key);
    if (!grant) {
      grant = {
        key,
        roleName: roleNameOf(assignment),
        tier: roleTier(assignment),
        customRoleId: assignment.customRoleId,
        scopes: [],
      };
      byRole.set(key, grant);
    }
    if (!grant.scopes.some((scope) => scope.scopeId === assignment.scopeId)) {
      grant.scopes.push({
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
        scopeName: assignment.scopeName,
      });
    }
  }

  for (const grant of byRole.values()) {
    grant.scopes.sort(
      (a, b) =>
        SCOPE_ORDER[a.scopeType] - SCOPE_ORDER[b.scopeType] ||
        (a.scopeName ?? "").localeCompare(b.scopeName ?? ""),
    );
  }

  return [...byRole.values()].sort((a, b) =>
    a.roleName.localeCompare(b.roleName),
  );
}

export function holdersOf(assignments: readonly AssignmentRow[]): Holder[] {
  const byHolder = new Map<string, { holder: Holder; rows: AssignmentRow[] }>();

  for (const assignment of assignments) {
    const identity = holderIdentity(assignment);
    let entry = byHolder.get(identity.key);
    if (!entry) {
      entry = {
        holder: {
          key: identity.key,
          kind: identity.kind,
          userId: assignment.userId,
          name: identity.name,
          address: identity.address,
          image: assignment.userImage,
          directory: assignment.groupScimSource,
          grants: [],
          assignmentCount: 0,
        },
        rows: [],
      };
      byHolder.set(identity.key, entry);
    }
    entry.rows.push(assignment);
  }

  const holders = [...byHolder.values()].map(({ holder, rows }) => ({
    ...holder,
    grants: collapseGrants(rows),
    assignmentCount: rows.length,
  }));

  const kindOrder: Record<HolderKind, number> = {
    person: 0,
    group: 1,
    apiKey: 2,
  };

  return holders.sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name),
  );
}

function plural({ count, word }: { count: number; word: string }): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * "Organization, and 3 teams". The one-line answer to "where does this apply",
 * for a grant with more scopes than a row has room for.
 */
export function summariseScopes(scopes: readonly GrantScope[]): string {
  const teams = scopes.filter((scope) => scope.scopeType === "TEAM").length;
  const projects = scopes.filter(
    (scope) => scope.scopeType === "PROJECT",
  ).length;
  const organization = scopes.some(
    (scope) => scope.scopeType === "ORGANIZATION",
  );

  const parts: string[] = [];
  if (organization) parts.push("Organization");
  if (teams > 0) parts.push(plural({ count: teams, word: "team" }));
  if (projects > 0) parts.push(plural({ count: projects, word: "project" }));

  if (parts.length === 0) return "Nowhere";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * How many people hold a built-in role, counting the ones who hold it through
 * a group as well as the ones granted it directly.
 *
 * A group's grant belongs to everyone in it, and an administrator asking "how
 * many people are admins here" is not asking how many rows there are.
 */
export function peopleHoldingRole({
  assignments,
  tier,
}: {
  assignments: readonly AssignmentRow[];
  tier: string;
}): number {
  const people = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.customRoleId) continue;
    if (assignment.role !== tier) continue;
    if (assignment.userId) people.add(assignment.userId);
    for (const memberId of assignment.memberUserIds ?? []) people.add(memberId);
  }
  return people.size;
}

export function peopleHoldingCustomRole({
  assignments,
  customRoleId,
}: {
  assignments: readonly AssignmentRow[];
  customRoleId: string;
}): number {
  const people = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.customRoleId !== customRoleId) continue;
    if (assignment.userId) people.add(assignment.userId);
    for (const memberId of assignment.memberUserIds ?? []) people.add(memberId);
  }
  return people.size;
}

/** Everyone and every group a custom role was handed to. */
export function holdersOfCustomRole({
  assignments,
  customRoleId,
}: {
  assignments: readonly AssignmentRow[];
  customRoleId: string;
}): Holder[] {
  return holdersOf(
    assignments.filter(
      (assignment) => assignment.customRoleId === customRoleId,
    ),
  );
}

/** Every distinct scope a custom role is in force on. */
export function scopesOfCustomRole({
  assignments,
  customRoleId,
}: {
  assignments: readonly AssignmentRow[];
  customRoleId: string;
}): GrantScope[] {
  const scopes = new Map<string, GrantScope>();
  for (const assignment of assignments) {
    if (assignment.customRoleId !== customRoleId) continue;
    scopes.set(assignment.scopeId, {
      scopeType: assignment.scopeType,
      scopeId: assignment.scopeId,
      scopeName: assignment.scopeName,
    });
  }
  return [...scopes.values()].sort(
    (a, b) =>
      SCOPE_ORDER[a.scopeType] - SCOPE_ORDER[b.scopeType] ||
      (a.scopeName ?? "").localeCompare(b.scopeName ?? ""),
  );
}

/** How many assignments sit at each scope, for the filter above the list. */
export function scopeCounts(
  assignments: readonly AssignmentRow[],
): Record<"ALL" | AssignmentScopeType, number> {
  return {
    ALL: assignments.length,
    ORGANIZATION: assignments.filter(
      (assignment) => assignment.scopeType === "ORGANIZATION",
    ).length,
    TEAM: assignments.filter((assignment) => assignment.scopeType === "TEAM")
      .length,
    PROJECT: assignments.filter(
      (assignment) => assignment.scopeType === "PROJECT",
    ).length,
  };
}
