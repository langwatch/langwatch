/**
 * The icon of a board's scope, as the prompt scope draws it, with a lock for the choice a
 * prompt does not have; and the quiet mark by a board's name in a list, which a Project board
 * does not carry.
 */

import type { DashboardScope } from "@langwatch/dashboard-contract";
import { Box } from "@langwatch/design-system/primitives";
import { Building, Lock, type LucideIcon, Users } from "lucide-react";

import { scopeMarkTip } from "../../model/board-scope.ts";

export const SCOPE_ICON: Record<DashboardScope, LucideIcon> = {
  PRIVATE: Lock,
  PROJECT: Users,
  ORGANIZATION: Building,
};

export function ScopeMark({
  scope,
  organization,
}: {
  scope: DashboardScope;
  organization: string;
}) {
  const tip = scopeMarkTip({ scope, organization });
  if (tip === void 0) return null;
  const Icon = SCOPE_ICON[scope];
  return (
    <Box
      as="span"
      display="flex"
      flexShrink={0}
      color="fg.subtle"
      title={tip}
      data-scope-mark={scope}
    >
      <Icon size={11} aria-label={tip} />
    </Box>
  );
}
