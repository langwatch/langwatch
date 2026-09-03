/**
 * Whether a member takes a full seat or a lite one.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/server/license-enforcement/member-classification.ts`,
 * which stays: six server modules import it — the enforcement service, the
 * limit guard, the repository, the organization service and the invite service —
 * and the deletes-only ruling forbids repointing any of them. The RBAC family's
 * rule for a copy applies and is met: this restatement can only ever be as
 * narrow as the original, because it reads the SAME two inputs and returns the
 * SAME two words, and the seat count a customer is billed for is decided by the
 * server copy and never by this one. What this copy decides is a LABEL next to
 * a name on the subscription page.
 *
 * It dies when the classification moves into `@langwatch/enterprise-licensing-contract`,
 * where both halves could name it.
 */

import type { MemberType } from "@langwatch/enterprise-licensing-contract";
import { OrganizationUserRole } from "./prisma-types";

/**
 * A permission that grants nothing but a read.
 *
 * The ACTION half of `resource:action` decides it, read by splitting rather
 * than by a suffix match, exactly as the server copy does: a resource whose
 * name happens to end in "view" must not be mistaken for a view grant.
 */
function isViewOnlyPermission(permission: string): boolean {
  return permission.split(":")[1] === "view";
}

/**
 * A custom role that grants nothing but reads.
 *
 * Anything beyond `:view` — a create, an update, a delete, a manage — is what
 * elevates an `EXTERNAL` membership to a full seat.
 */
function isViewOnlyCustomRole(permissions: string[]): boolean {
  return permissions.every(isViewOnlyPermission);
}

export function classifyMemberType(
  role: OrganizationUserRole,
  permissions: string[] | undefined,
): MemberType {
  // ADMIN or MEMBER roles are always FullMember
  if (role === OrganizationUserRole.ADMIN || role === OrganizationUserRole.MEMBER) {
    return "FullMember";
  }

  // EXTERNAL role with non-view custom permissions is elevated to FullMember
  if (role === OrganizationUserRole.EXTERNAL && permissions && !isViewOnlyCustomRole(permissions)) {
    return "FullMember";
  }

  // EXTERNAL role with no permissions or view-only permissions is Lite Member
  return "LiteMember";
}
