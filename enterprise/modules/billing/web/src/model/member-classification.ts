/**
 * Whether member takes full or lite seat. Local copy for subscription page
 * label; server copy decides billing.
 */

import type { MemberType } from "@langwatch/enterprise-licensing-contract";
import { OrganizationUserRole } from "./prisma-types.ts";

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
