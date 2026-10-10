// The "Grant role" button; a reader who may not manage sees it greyed out and why.

import { Button } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Plus } from "lucide-react";

const NEEDS_MANAGE = "You need permission to manage this organization to grant a role.";

export type GrantRoleButtonProps = {
  onClick: () => void;
  canManage: boolean;
};

export function GrantRoleButton({ onClick, canManage }: GrantRoleButtonProps) {
  return (
    <Tooltip content={NEEDS_MANAGE} disabled={canManage}>
      <Button
        size="sm"
        colorPalette="blue"
        disabled={!canManage}
        onClick={onClick}
        data-testid="grant-role-open"
      >
        <Plus size={14} aria-hidden />
        Grant role
      </Button>
    </Tooltip>
  );
}
