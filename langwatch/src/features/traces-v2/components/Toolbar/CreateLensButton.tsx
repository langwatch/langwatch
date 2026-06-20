import { Box, Button, Text } from "@chakra-ui/react";
import type React from "react";
import { LuPlus } from "react-icons/lu";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useViewStore } from "../../stores/viewStore";
import { LensNamePopover } from "./LensNamePopover";

const BETA_TOOLTIP =
  "Lenses are saved in your browser during this beta. They don't sync across browsers or teammates yet.";

/**
 * Lens creation entry point — single path: type a name, snapshot the
 * current table state. Shares the `LensNamePopover` name-entry UI with
 * every other save-as-new site (Toolbar Save Lens, lens-tab menus), so
 * the input + trim + Enter/Escape behaviour lives in exactly one place.
 * The "Configure columns, sort, and more…" link (and its
 * LensConfigDialog) were retired in Round 3 — columns are managed
 * inline on the sidebar tab, sort is the column-header click everyone
 * already knows. Lens-creation lands in `viewStore.createLens`, which
 * persists the new lens to localStorage and switches the active tab.
 */
export const CreateLensButton: React.FC = () => {
  const createLens = useViewStore((s) => s.createLens);

  return (
    // Tooltip wraps a Box that *contains* the Popover instead of
    // wrapping the PopoverTrigger directly. Both the tooltip and popover
    // forwarding refs through the same `asChild` slot made Zag's
    // positioner lose the anchor (popover rendered top-left, or not at
    // all). Separating the ref chains via a Box host means Tooltip gets
    // the Box and the LensNamePopover trigger gets the Button, so each
    // finds its anchor cleanly.
    <Tooltip
      content={BETA_TOOLTIP}
      positioning={{ placement: "bottom" }}
      contentProps={{ maxWidth: "240px" }}
    >
      <Box display="inline-flex" marginLeft={1}>
        <LensNamePopover
          onSubmit={(name) => createLens(name)}
          placement="bottom-start"
          footer={
            <Text fontSize="2xs" color="fg.subtle" lineHeight="1.4">
              Saved locally during beta. Won't sync across browsers yet.
            </Text>
          }
        >
          <Button
            size="xs"
            variant="ghost"
            minWidth="auto"
            paddingX={1}
            aria-label="Create new lens"
            // Sitting inside Tabs.Root, the button was picking up a
            // faint border + focus ring from the tabs styling layer.
            // Explicit reset keeps it consistent with the other
            // ghost-icon affordances in the toolbar.
            border="0"
            _focusVisible={{ boxShadow: "none" }}
          >
            <LuPlus />
          </Button>
        </LensNamePopover>
      </Box>
    </Tooltip>
  );
};
