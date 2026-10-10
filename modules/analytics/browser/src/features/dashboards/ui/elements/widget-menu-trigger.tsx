/** The "⋮" a widget's menu opens from, on a stored board and on a read-only one. */

import { Menu } from "@langwatch/design-system/menu";
import { IconButton } from "@langwatch/design-system/primitives";
import { MoreVertical } from "lucide-react";

export function WidgetMenuTrigger({ name, disabled }: { name: string; disabled?: boolean }) {
  return (
    <Menu.Trigger asChild>
      <IconButton
        aria-label={`Actions for ${name}`}
        variant="ghost"
        size="xs"
        color="fg.subtle"
        _hover={{ color: "fg", background: "bg.muted" }}
        disabled={disabled}
      >
        <MoreVertical size={14} aria-hidden />
      </IconButton>
    </Menu.Trigger>
  );
}
