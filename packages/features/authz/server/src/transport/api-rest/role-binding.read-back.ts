/**
 * Answering a role-bindings write with the row it wrote.
 *
 * A write's response is meant to be byte-compatible with a later read, so it
 * is composed from the organization's listing rather than from the request.
 * That listing is fed by the grants projection, and the projection is behind
 * the append by design: `attachBindings` waits for it, but the wait is
 * BOUNDED and timeout-tolerant (the writer logs and returns; the fold
 * converges afterwards). A read-back miss on a create is therefore ordinary
 * lag on a write that certainly succeeded — not an inconsistency, and
 * certainly not a 500, which is what it used to be.
 *
 * So a create answers optimistically: the identity the writer minted plus the
 * facts the request stated, with the display names the listing would have
 * joined in left null because they are not known here. The caller gets the
 * id — the thing it needs to address the binding — and a follow-up read fills
 * the names in. Retrying instead would be the harmful move: a second create
 * for the same slot appends a SECOND grant while the projection is still
 * behind, and only answers 409 `role_binding_already_exists` once the first
 * one's row has landed.
 */
import type { RoleBindingScopeType, TeamUserRole } from "@langwatch/authz-contract";

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
  createdAt: Date;
};

/** The principal a create names — exactly one of the three id fields. */
export type CreatedPrincipal = {
  userId?: string | undefined;
  groupId?: string | undefined;
  apiKeyId?: string | undefined;
};

/**
 * The binding as the caller just wrote it, for the window in which the
 * projection has not caught up.
 *
 * `createdAt` is this moment rather than the fact's own stamp: the write
 * happened just now, and the projected row's exact timestamp is a detail the
 * follow-up read carries. Every name is null because the join that resolves
 * them is the listing this stands in for.
 */
export function optimisticBindingWire({
  id,
  principal,
  role,
  customRoleId,
  scopeType,
  scopeId,
  now = () => new Date(),
}: {
  id: string;
  principal: CreatedPrincipal;
  role: TeamUserRole;
  customRoleId?: string | undefined;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  now?: () => Date;
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
    createdAt: now(),
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
