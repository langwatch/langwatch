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

// Built-in binding identities keyed on role, custom ones on customRoleId.
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
