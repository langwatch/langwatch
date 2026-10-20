import { useDrawer } from "@langwatch/browser-host/drawer";
import { Button, Icon, IconButton } from "@langwatch/design-system/primitives";
import { shortcutAriaKeys } from "@langwatch/design-system/shortcut-hint";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Keyboard, Zap } from "lucide-react";
import type React from "react";

import { getCurrentFilterText } from "../../../../behavior/explorer.store.ts";
import { useTraceHost } from "../../../../behavior/trace-host.ts";
import { useUIStore } from "../../../../behavior/ui.store.ts";
import { PAGE_SHORTCUTS } from "../traces-page/page-keyboard-shortcuts.tsx";

/**
 * Turns the current filter into a trace automation (ADR-043): the automation drawer opens
 * with the applied query as its subject. Hidden for readers who cannot manage triggers.
 */
export const AutomateButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const traceHost = useTraceHost();
  const { openDrawer } = useDrawer();
  if (!traceHost.hasPermission("triggers:manage")) return null;

  return (
    <Tooltip
      content="Create an automation from the current filter"
      positioning={{ placement: "bottom" }}
    >
      <Button
        size="xs"
        variant="ghost"
        aria-label="Create an automation from the current filter"
        data-testid="trace-toolbar-automate"
        flexShrink={0}
        onClick={() =>
          openDrawer("automation", {
            initialSource: "trace",
            initialFilterQuery: getCurrentFilterText(),
          })
        }
      >
        <Icon boxSize={3.5}>
          <Zap />
        </Icon>
        {!compact && "Automate"}
      </Button>
    </Tooltip>
  );
};

/** Opens the keyboard shortcuts sheet; `?` does the same. */
export const KeyboardShortcutsButton: React.FC = () => {
  const toggleShortcutsHelp = useUIStore((s) => s.toggleShortcutsHelp);

  return (
    <Tooltip
      content="Keyboard shortcuts"
      shortcut={PAGE_SHORTCUTS.help}
      positioning={{ placement: "bottom" }}
    >
      <IconButton
        size="xs"
        variant="ghost"
        color="fg.muted"
        aria-label="Keyboard shortcuts"
        aria-keyshortcuts={shortcutAriaKeys(PAGE_SHORTCUTS.help)}
        data-testid="trace-toolbar-shortcuts"
        onClick={toggleShortcutsHelp}
      >
        <Keyboard size={14} />
      </IconButton>
    </Tooltip>
  );
};
