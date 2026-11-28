/**
 * Whether a full seat would lift a Lite Member's refusal: a full member holds the permission.
 * Admin-only permissions (project:manage, team:manage) offer no seat request.
 */
import { builtinRoleGrants } from "@langwatch/authz-contract";

export function fullSeatLifts(permission: string | undefined): boolean {
  if (permission === undefined) return true;
  return (
    builtinRoleGrants({ role: "member", permission }) ||
    builtinRoleGrants({ role: "org-member", permission })
  );
}
