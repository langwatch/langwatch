/**
 * The membership fence's pure half (specs/rbac/authz-grants.feature):
 * which attaches need a locked generation, which one each carries, and the
 * one shape allowed to state its own.
 */
import type { RoleBindingScopeType, TeamUserRole } from "@langwatch/authz-contract";

/** Exactly the fields the fence reads off a binding about to be attached. */
export type FencedBindingAttach = {
  principal: { userId?: string | undefined };
  role: TeamUserRole;
  customRoleId: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  membershipStamp?: string;
  membershipBootstrap?: boolean;
};

/** The fence fields a grant entry carries; empty for a principal with no membership. */
export type MembershipFenceFields = {
  membershipStamp?: string;
  membershipBootstrap?: boolean;
};

/**
 * The users whose membership row must be locked and read: a binding that
 * already carries its own generation states it from inside the transaction
 * that created the membership, and a non-USER principal has none.
 */
export function userIdsNeedingStamp(bindings: FencedBindingAttach[]): string[] {
  return [
    ...new Set(
      bindings.flatMap((binding) =>
        binding.membershipStamp || !binding.principal.userId ? [] : [binding.principal.userId],
      ),
    ),
  ];
}

/** The generation this binding rides with, its own taking precedence. */
export function membershipFenceFields(
  binding: FencedBindingAttach,
  stamps: Map<string, string>,
): MembershipFenceFields {
  const userId = binding.principal.userId;
  const membershipStamp =
    binding.membershipStamp ?? (userId === undefined ? undefined : stamps.get(userId));
  return {
    ...(membershipStamp ? { membershipStamp } : {}),
    ...(binding.membershipBootstrap ? { membershipBootstrap: true } : {}),
  };
}

function isFounderAdminScope({
  organizationId,
  binding,
}: {
  organizationId: string;
  binding: FencedBindingAttach;
}): boolean {
  if (binding.scopeType === "TEAM") return true;
  if (binding.scopeType !== "ORGANIZATION") return false;
  return binding.scopeId === organizationId;
}

/**
 * The bootstrap marker lets a grant in before its membership row is visible,
 * so it is bounded to the founder's own two ADMIN bindings and nothing else.
 */
export function validateMembershipBootstrap({
  organizationId,
  binding,
}: {
  organizationId: string;
  binding: FencedBindingAttach;
}): void {
  if (!binding.membershipBootstrap) return;
  const refusal = new Error(
    "membershipBootstrap is only valid for stamped USER ADMIN organization/team bindings",
  );
  if (!binding.principal.userId) throw refusal;
  if (!binding.membershipStamp) throw refusal;
  if (binding.role !== "ADMIN") throw refusal;
  if (binding.customRoleId !== null) throw refusal;
  if (!isFounderAdminScope({ organizationId, binding })) throw refusal;
}
