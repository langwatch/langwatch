import { Box, Button, Text } from "@chakra-ui/react";
import type React from "react";
import { LuPlus } from "react-icons/lu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useViewStore } from "../../../../index";
import { LensNamePopover } from "../../../elements/explorer/toolbar/lens-name-popover";

const BETA_TOOLTIP =
  "Save the current columns, sort, and filter as a lens. Lenses sync to your account; team-shared lenses are coming.";

/**
 * Lens creation entry point — single path: type a name, snapshot the current table
 * state.
 */
export const CreateLensButton: React.FC = () => {
  const createLens = useViewStore((s) => s.createLens);

  return (
    // Tooltip wraps a Box that *contains* the Popover instead of wrapping the
    // PopoverTrigger directly.
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
              Lenses sync to your account. Sharing with teammates is coming.
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
