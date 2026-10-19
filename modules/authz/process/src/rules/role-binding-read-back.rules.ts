// Creates answer optimistically while projection catches up; follow-up read fills names.
import type {
  AuthzManagedOrganizationBinding,
  RoleBindingPrincipal,
  RoleBindingRest,
  GrantScopeTier,
  TeamUserRole,
} from "@langwatch/authz-contract";
import { type Instant, toDate } from "@langwatch/time";

/** One binding as both the list and the writes report it. */
type BindingWire = {
  id: string;
  principal: {
    type: "user" | "group" | "apiKey";
    id: string;
    name: string | null;
  };
  role: TeamUserRole;
  customRoleId: string | null;
  customRoleName: string | null;
  scopeType: GrantScopeTier;
  scopeId: string;
  scopeName: string | null;
  /** The wire's own moment type: the listing contract declares it. */
  createdAt: AuthzManagedOrganizationBinding["createdAt"];
  expiresAt: RoleBindingRest["expiresAt"];
};

/** The principal a create names — exactly one of the three id fields. */
type CreatedPrincipal = {
  userId?: string | undefined;
  groupId?: string | undefined;
  apiKeyId?: string | undefined;
};

// Optimistic binding from writer's data; createdAt is now, names null.
export function optimisticBindingWire({
  id,
  principal,
  role,
  customRoleId,
  scopeType,
  scopeId,
  expiresAt,
  now,
}: {
  id: string;
  principal: CreatedPrincipal;
  role: TeamUserRole;
  customRoleId?: string | undefined;
  scopeType: GrantScopeTier;
  scopeId: string;
  expiresAt?: RoleBindingRest["expiresAt"] | undefined;
  now: () => Instant;
}): BindingWire {
  return {
    id,
    principal: principalOfCreated(principal),
    role,
    customRoleId: customRoleId ?? null,
    customRoleName: null,
    scopeType,
    scopeId,
    scopeName: null,
    createdAt: toDate(now()),
    // The caller's own term, so the optimistic answer can state it exactly.
    expiresAt: expiresAt ?? null,
  };
}

function principalOfCreated({
  userId,
  groupId,
  apiKeyId,
}: CreatedPrincipal): BindingWire["principal"] {
  if (userId) return { type: "user", id: userId, name: null };
  if (groupId) return { type: "group", id: groupId, name: null };
  // The service refuses a create naming no principal, so the last branch is
  // the API key one rather than a fallback for "none of the above".
  return { type: "apiKey", id: apiKeyId ?? "", name: null };
}

function principalOf(row: AuthzManagedOrganizationBinding): RoleBindingPrincipal {
  if (row.userId) return { type: "user", id: row.userId, name: row.userName ?? null };
  if (row.groupId) return { type: "group", id: row.groupId, name: row.groupName ?? null };

  return { type: "apiKey", id: row.apiKeyId ?? "", name: row.apiKeyName ?? null };
}

/** One managed binding as the role-bindings REST family reports it. */
export function bindingWire(row: AuthzManagedOrganizationBinding): RoleBindingRest {
  return {
    id: row.id,
    principal: principalOf(row),
    role: row.role,
    customRoleId: row.customRoleId,
    customRoleName: row.customRoleName,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    scopeName: row.scopeName,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt ?? null,
  };
}
