import { Badge } from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";
import { orgRoleOptions } from "./orgRoleOptions";

const roleLabelMap = new Map(
  orgRoleOptions.map((option) => [option.value, option.label])
);

export function getRoleBadgeColor(
  role: OrganizationUserRole
): "blue" | "orange" {
  switch (role) {
    case OrganizationUserRole.ADMIN:
    case OrganizationUserRole.MEMBER:
      return "blue";
    case OrganizationUserRole.EXTERNAL:
      return "orange";
    default: {
      const _exhaustiveCheck: never = role;
      return _exhaustiveCheck;
    }
  }
}

export function RoleBadge({ role }: { role: OrganizationUserRole }) {
  const label = roleLabelMap.get(role) ?? role;
  const colorPalette = getRoleBadgeColor(role);

  return (
    <Badge colorPalette={colorPalette} variant="subtle" size="sm">
      {label}
    </Badge>
  );
}
