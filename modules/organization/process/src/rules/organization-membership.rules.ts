import { OrganizationUserRole } from "@langwatch/organization-contract";

/** A role change that takes the ADMIN seat away: the only one that can shrink the admin set. */
export function isAdminDemotion({
  currentRole,
  role,
}: {
  currentRole: OrganizationUserRole;
  role: OrganizationUserRole;
}): boolean {
  return currentRole === OrganizationUserRole.ADMIN && role !== OrganizationUserRole.ADMIN;
}

/**
 * An admin who can still sign in; removing the last one leaves the organization unrecoverable.
 * `disabledAt` is `object` so a prisma `Date` and a memory `Instant` both fit; `undefined` doesn't.
 */
export function isActiveAdmin({
  role,
  disabledAt,
}: {
  role: OrganizationUserRole;
  disabledAt: object | null;
}): boolean {
  return role === OrganizationUserRole.ADMIN && disabledAt === null;
}

/** The count includes the member being changed, so one left means the change leaves none. */
export function isLastAdmin({ adminCount }: { adminCount: number }): boolean {
  return adminCount <= 1;
}

/** Only a user-created role of this same organization may be assigned. */
export function isAssignableCustomRole({
  customRole,
  organizationId,
}: {
  customRole: { kind: string; organizationId: string | null } | null;
  organizationId: string;
}): boolean {
  return customRole?.kind === "custom" && customRole.organizationId === organizationId;
}
