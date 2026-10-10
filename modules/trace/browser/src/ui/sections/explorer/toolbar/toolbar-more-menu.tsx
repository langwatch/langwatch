import { useDrawer } from "@langwatch/browser-host/drawer";
import {
  MenuContent,
  MenuItem,
  MenuItemCommand,
  MenuRoot,
  MenuTrigger,
} from "@langwatch/design-system/menu";
import { IconButton } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { TriggerAnchor } from "@langwatch/design-system/trigger-anchor";
import { Keyboard, MoreHorizontal, Zap } from "lucide-react";
import type React from "react";

import { getCurrentFilterText } from "../../../../behavior/explorer.store.ts";
import { useTraceHost } from "../../../../behavior/trace-host.ts";
import { useUIStore } from "../../../../behavior/ui.store.ts";

/**
 * The toolbar's less-used actions: turning the current filter into an automation
 * (ADR-043) and the keyboard shortcuts sheet.
 */
export const ToolbarMoreMenu: React.FC = () => {
  const traceHost = useTraceHost();
  const { openDrawer } = useDrawer();
  const toggleShortcutsHelp = useUIStore((s) => s.toggleShortcutsHelp);
  const canAutomate = traceHost.hasPermission("triggers:manage");

  return (
    <MenuRoot positioning={{ placement: "bottom-end" }}>
      <Tooltip content="More actions" positioning={{ placement: "bottom" }}>
        <TriggerAnchor>
          <MenuTrigger asChild>
            <IconButton
              size="xs"
              variant="ghost"
              color="fg.muted"
              aria-label="More toolbar actions"
              data-testid="trace-toolbar-more"
            >
              <MoreHorizontal size={14} />
            </IconButton>
          </MenuTrigger>
        </TriggerAnchor>
      </Tooltip>
      <MenuContent minWidth="240px">
        {canAutomate && (
          <MenuItem
            value="automate"
            onClick={() =>
              openDrawer("automation", {
                initialSource: "trace",
                initialFilterQuery: getCurrentFilterText(),
              })
            }
          >
            <Zap size={14} />
            Create an automation from the current filter
          </MenuItem>
        )}
        <MenuItem value="shortcuts" onClick={toggleShortcutsHelp}>
          <Keyboard size={14} />
          Keyboard shortcuts
          <MenuItemCommand>?</MenuItemCommand>
        </MenuItem>
      </MenuContent>
    </MenuRoot>
  );
};
