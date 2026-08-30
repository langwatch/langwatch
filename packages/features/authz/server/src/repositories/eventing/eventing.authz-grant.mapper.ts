import { authzBindingIdentityKey } from "@langwatch/authz-contract";

/** The one principal a binding identity is keyed on. */
export type BindingIdentityPrincipal = {
  userId?: string | null;
  groupId?: string | null;
  apiKeyId?: string | null;
};

export type BindingIdentityInput = {
  principal: BindingIdentityPrincipal;
  scopeType: string;
  scopeId: string;
  role: string;
  customRoleId: string | null;
};

/**
 * A binding's identity as the database's partial unique indexes define it
 * (migration `20260410120000_fix_role_binding_unique_custom_role`): a
 * built-in binding is keyed on its role, a custom one on its custom role id
 * — the role column is not part of a custom binding's identity at all. Two
 * rows with the same key are the same grant, whatever their row ids.
 *
 * Callers that compare across vocabularies (a legacy enum against the
 * ledger's role key) normalize their `role` before calling this — this
 * function only joins what it is given.
 *
 * Joined on the ASCII unit separator, not a delimiter that could appear
 * inside an id or an enum, the same choice `deriveGrantId` makes in
 * adapters/eventing.authz-grant.adapter.ts.
 */
export function bindingIdentityKey({
  principal,
  scopeType,
  scopeId,
  role,
  customRoleId,
}: BindingIdentityInput): string {
  let resolvedPrincipal: { userId: string } | { groupId: string } | { apiKeyId: string } | null =
    null;
  if (principal.userId) resolvedPrincipal = { userId: principal.userId };
  else if (principal.groupId) {
    resolvedPrincipal = { groupId: principal.groupId };
  } else if (principal.apiKeyId) {
    resolvedPrincipal = { apiKeyId: principal.apiKeyId };
  }
  if (!resolvedPrincipal) throw new Error("a binding identity names no principal");
  return authzBindingIdentityKey({
    principal: resolvedPrincipal,
    scopeType,
    scopeId,
    role,
    customRoleId,
  });
}
