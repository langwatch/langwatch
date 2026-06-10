import { Button } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import type React from "react";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "~/components/ui/menu";

export interface OverflowMenuItem {
  id: string;
  label: React.ReactNode;
  /** Optional inline-start icon (Chakra/Lucide ReactNode). */
  icon?: React.ReactNode;
  /** Optional inline-end accessory (badge, kbd, count, …). */
  endSlot?: React.ReactNode;
  /** Disable the menu row without removing it. */
  disabled?: boolean;
  /**
   * Full row content override. When provided, the menu item renders
   * `content` instead of the default `icon` + `label` + `endSlot`
   * arrangement — useful when the caller wants the dropdown row to
   * mirror exactly what the in-row visible item renders (icon + label
   * + kbd shortcut + counts, etc.) without re-plumbing each field.
   */
  content?: React.ReactNode;
}

interface OverflowMenuProps {
  items: readonly OverflowMenuItem[];
  /**
   * Renders the active id in a bolder weight so the user can see
   * which option in the dropdown corresponds to the currently
   * selected tab. Optional.
   */
  activeId?: string | null;
  onSelect: (id: string) => void;
  /** Tooltip / aria label for the trigger. */
  ariaLabel?: string;
  /** Optional trigger size override; defaults to xs. */
  triggerSize?: "xs" | "sm";
}

/**
 * Three-dot overflow menu used to surface row items that no longer
 * fit alongside their siblings. Pair with `useOverflowVisibility` to
 * decide which items belong in the menu vs the visible row.
 */
export const OverflowMenu: React.FC<OverflowMenuProps> = ({
  items,
  activeId,
  onSelect,
  ariaLabel,
  triggerSize = "xs",
}) => {
  if (items.length === 0) return null;
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button
          size={triggerSize}
          variant="ghost"
          paddingX={0.5}
          minWidth="auto"
          height={triggerSize === "sm" ? "26px" : "22px"}
          color="fg.muted"
          aria-label={ariaLabel ?? `Show ${items.length} more`}
        >
          <MoreVertical size={14} />
        </Button>
      </MenuTrigger>
      <MenuContent minWidth="180px">
        {items.map((item) => (
          <MenuItem
            key={item.id}
            value={item.id}
            onClick={() => !item.disabled && onSelect(item.id)}
            disabled={item.disabled}
            fontWeight={item.id === activeId ? "semibold" : undefined}
          >
            {item.content ?? (
              <>
                {item.icon}
                {item.label}
                {item.endSlot}
              </>
            )}
          </MenuItem>
        ))}
      </MenuContent>
    </MenuRoot>
  );
};
