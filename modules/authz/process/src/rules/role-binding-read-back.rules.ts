// Creates answer optimistically while projection catches up; follow-up read fills names.
import type {
  AuthzManagedOrganizationBinding,
  RoleBindingScopeType,
  TeamUserRole,
} from "@langwatch/authz-contract";
import { type Instant, toDate } from "@langwatch/time";

/** One binding as both the list and the writes report it. */
export type BindingWire = {
  id: string;
  principal: {
    type: "user" | "group" | "apiKey";
    id: string;
    name: string | null;
  };
  role: TeamUserRole;
  customRoleId: string | null;
  customRoleName: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  scopeName: string | null;
  /** The wire's own moment type: the listing contract declares it. */
  createdAt: AuthzManagedOrganizationBinding["createdAt"];
};

/** The principal a create names — exactly one of the three id fields. */
export type CreatedPrincipal = {
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
  now,
}: {
  id: string;
  principal: CreatedPrincipal;
  role: TeamUserRole;
  customRoleId?: string | undefined;
  scopeType: RoleBindingScopeType;
  scopeId: string;
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
