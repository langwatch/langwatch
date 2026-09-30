// What the grant dialog offers: roles, members, groups and the reader's standing.

import type { GrantScope } from "@langwatch/authz-browser-kit";

import { authzApi } from "./authz-api.ts";

export function useGrantDialogData({
  organizationId,
  scope,
  isEditing,
}: {
  organizationId: string;
  scope: GrantScope;
  isEditing: boolean;
}) {
  const roles = authzApi.role.getAll.useQuery({ organizationId });
  const members = authzApi.organization.getAllOrganizationMembers.useQuery(
    { organizationId },
    { enabled: !isEditing },
  );
  const groups = authzApi.group.listAll.useQuery({ organizationId }, { enabled: !isEditing });
  // A team's standing cannot be asked for, so no role is greyed out there.
  const standing = authzApi.authz.effectivePermissions.useQuery(
    scope.type === "project" ? { projectId: scope.id } : { organizationId },
    { enabled: scope.type !== "team" },
  );

  return {
    roles: roles.data ?? [],
    members: members.data ?? [],
    groups: groups.data ?? [],
    heldPermissions: standing.data?.permissions,
  };
}
