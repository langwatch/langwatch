// How a binding row reads as a grant on `/api/grants`, and how a list pages. Pure.
import {
  GRANT_CURSOR_PATTERN,
  builtInRoleIdSchema,
  type AuthzManagedOrganizationBinding,
  type BuiltInRoleId,
  type Grant,
  type GrantListQuery,
  type GrantPage,
  type GrantScopeType,
  type RoleBindingScopeType,
  type TeamUserRole,
} from "@langwatch/authz-contract";

const BUILT_IN_ROLE: Readonly<Record<BuiltInRoleId, { role: TeamUserRole; name: string }>> = {
  admin: { role: "ADMIN", name: "Admin" },
  member: { role: "MEMBER", name: "Member" },
  viewer: { role: "VIEWER", name: "Viewer" },
};

const SCOPE_TYPE: Readonly<Record<GrantScopeType, RoleBindingScopeType>> = {
  organization: "ORGANIZATION",
  team: "TEAM",
  project: "PROJECT",
};

const WIRE_SCOPE_TYPE: Readonly<Record<RoleBindingScopeType, GrantScopeType>> = {
  ORGANIZATION: "organization",
  TEAM: "team",
  PROJECT: "project",
};

export function storedScopeType(scopeType: GrantScopeType): RoleBindingScopeType {
  return SCOPE_TYPE[scopeType];
}

/** A role id as the ledger stores it: a built-in role, or CUSTOM naming the custom role. */
export function storedRole(roleId: string): { role: TeamUserRole; customRoleId: string | null } {
  const builtIn = builtInRoleIdSchema.safeParse(roleId);
  if (builtIn.success) return { role: BUILT_IN_ROLE[builtIn.data].role, customRoleId: null };

  return { role: "CUSTOM", customRoleId: roleId };
}

const BUILT_IN_ID: Readonly<Record<Exclude<TeamUserRole, "CUSTOM">, BuiltInRoleId>> = {
  ADMIN: "admin",
  MEMBER: "member",
  VIEWER: "viewer",
};

function principalOf(row: AuthzManagedOrganizationBinding): Grant["principal"] {
  if (row.userId) return { type: "user", id: row.userId, name: row.userName ?? row.userEmail };
  if (row.groupId) return { type: "group", id: row.groupId, name: row.groupName };

  return { type: "apiKey", id: row.apiKeyId ?? "", name: row.apiKeyName };
}

function roleOf(row: AuthzManagedOrganizationBinding): Grant["role"] {
  if (row.role !== "CUSTOM" && !row.customRoleId) {
    const id = BUILT_IN_ID[row.role];
    return { id, name: BUILT_IN_ROLE[id].name, builtIn: true };
  }

  return { id: row.customRoleId ?? "", name: row.customRoleName, builtIn: false };
}

export function grantWire({
  row,
  nowMs,
}: {
  row: AuthzManagedOrganizationBinding;
  nowMs: number;
}): Grant {
  const expiresAt = row.expiresAt ?? null;

  return {
    id: row.id,
    principal: principalOf(row),
    role: roleOf(row),
    scope: { type: WIRE_SCOPE_TYPE[row.scopeType], id: row.scopeId, name: row.scopeName },
    status: expiresAt && expiresAt.getTime() <= nowMs ? "expired" : "active",
    expiresAt,
    createdAt: row.createdAt,
  };
}

export function matchesGrantQuery({
  grant,
  query,
}: {
  grant: Grant;
  query: GrantListQuery;
}): boolean {
  return (
    (query.principalType === undefined || grant.principal.type === query.principalType) &&
    (query.principalId === undefined || grant.principal.id === query.principalId) &&
    (query.roleId === undefined || grant.role.id === query.roleId) &&
    (query.scopeType === undefined || grant.scope.type === query.scopeType) &&
    (query.scopeId === undefined || grant.scope.id === query.scopeId) &&
    (query.status === undefined || grant.status === query.status)
  );
}

type Position = Readonly<{ createdAtMs: number; id: string }>;

function positionOf(grant: Grant): Position {
  return { createdAtMs: grant.createdAt.getTime(), id: grant.id };
}

function isAfter({ grant, position }: { grant: Grant; position: Position }): boolean {
  const createdAtMs = grant.createdAt.getTime();
  if (createdAtMs !== position.createdAtMs) return createdAtMs > position.createdAtMs;

  return grant.id > position.id;
}

export function encodeGrantCursor(position: Position): string {
  return `${position.createdAtMs}.${Buffer.from(position.id, "utf8").toString("base64url")}`;
}

/** The position a cursor names; a string the list never issued names none. */
export function findCursorPosition(cursor: string): Position[] {
  if (!GRANT_CURSOR_PATTERN.test(cursor)) return [];
  const [createdAtMs = "", encodedId = ""] = cursor.split(".");

  return [
    { createdAtMs: Number(createdAtMs), id: Buffer.from(encodedId, "base64url").toString("utf8") },
  ];
}

/** Oldest first, ties by id, so a page boundary never moves under a later write. */
export function pageGrants({
  grants,
  query,
  after,
}: {
  grants: readonly Grant[];
  query: GrantListQuery;
  after: Position | undefined;
}): GrantPage {
  const ordered = grants
    .filter((grant) => matchesGrantQuery({ grant, query }))
    .filter((grant) => after === undefined || isAfter({ grant, position: after }))
    .toSorted((a, b) => {
      if (isAfter({ grant: a, position: positionOf(b) })) return 1;

      return a.id === b.id ? 0 : -1;
    });
  const page = ordered.slice(0, query.limit);
  const last = page.at(-1);

  return {
    grants: page,
    nextCursor: ordered.length > query.limit && last ? encodeGrantCursor(positionOf(last)) : null,
  };
}
