// How a grant write reads before the store: its row, its ledger actor, its failure. Pure.
import { toLedgerActor, type Actor, type LedgerActor } from "@langwatch/authorization";
import type { GrantRole, GrantableAuthzScopeRef } from "@langwatch/authz-contract";

import type { BindingPrincipalWhere, GrantWrite } from "../repositories/authz-grant.repository.ts";

export const SCOPE_TYPE_FOR_REF = {
  project: "PROJECT",
  team: "TEAM",
  organization: "ORGANIZATION",
} as const;

export const RESOURCE_SCOPE_REJECTION =
  "Resource-tier access is granted by sharing the resource, not by a role binding";

/** The row a grant write stores. */
export function grantWriteRow({
  bindingId,
  principal,
  role,
  where,
  organizationId,
  expiresAtMs,
}: {
  bindingId: string;
  principal: BindingPrincipalWhere;
  role: GrantRole;
  where: GrantableAuthzScopeRef;
  organizationId: string;
  expiresAtMs: number | undefined;
}): GrantWrite {
  return {
    bindingId,
    organizationId,
    scopeType: SCOPE_TYPE_FOR_REF[where.type],
    scopeId: where.id,
    role: "customRoleId" in role ? "CUSTOM" : role.builtin,
    customRoleId: "customRoleId" in role ? role.customRoleId : null,
    principal,
    // Omitted, never `undefined`: a grant with no end date keeps the shape it always had.
    ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
  };
}

export function grantLedgerActor(actor: { userId: string } | Actor): LedgerActor {
  return toLedgerActor("userId" in actor ? { type: "user", id: actor.userId } : actor);
}

/** Which refusal a store failure's string `code` names, if it names one this write knows. */
export function knownWriteFailure(error: unknown): "duplicate" | "not_found" | "unknown" {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;

  if (code === "role_binding_already_exists") return "duplicate";
  if (code === "role_binding_not_found") return "not_found";
  return "unknown";
}
