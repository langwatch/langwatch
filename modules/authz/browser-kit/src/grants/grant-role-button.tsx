// The "Grant role" button; a refusal greys it out and says why in its tooltip.

import { Button } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Plus } from "lucide-react";

export type GrantRoleButtonProps = {
  onClick: () => void;
  /** Set when granting is refused (no permission, or the plan): the text is the tooltip. */
  refusal?: string | null;
};

export function GrantRoleButton({ onClick, refusal }: GrantRoleButtonProps) {
  return (
    <Tooltip content={refusal ?? ""} disabled={!refusal}>
      <Button
        size="sm"
        colorPalette="blue"
        disabled={!!refusal}
        onClick={onClick}
        data-testid="grant-role-open"
      >
        <Plus size={14} aria-hidden />
        Grant role
      </Button>
    </Tooltip>
  );
}
