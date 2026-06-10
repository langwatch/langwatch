import { Box, Button, HStack, Input, Stack, Text } from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
import { LuPlus } from "react-icons/lu";
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "../../../../components/ui/popover";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useViewStore } from "../../stores/viewStore";

const BETA_TOOLTIP =
  "Lenses are saved in your browser during this beta. They don't sync across browsers or teammates yet.";

/**
 * Lens creation entry point — single path: type a name, snapshot the
 * current table state. The "Configure columns, sort, and more…" link
 * (and its LensConfigDialog) were retired in Round 3 — columns are
 * managed inline on the sidebar tab, sort is the column-header click
 * everyone already knows, so the heavyweight dialog had no remaining
 * users. Lens-creation lands in `viewStore.createLens`, which
 * persists the new lens to localStorage and switches the active tab.
 */
export const CreateLensButton: React.FC = () => {
  const createLens = useViewStore((s) => s.createLens);
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  const reset = (): void => {
    setName("");
    setOpen(false);
  };

  const submitQuick = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createLens(trimmed);
    reset();
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter") submitQuick();
    else if (e.key === "Escape") reset();
  };

  return (
    <>
      {/* Tooltip wraps a Box that *contains* the Popover instead of
          wrapping the PopoverTrigger directly. The previous nesting
          (`Tooltip > PopoverTrigger asChild > Button`) had both the
          tooltip and popover trying to forward refs through the same
          asChild slot, which made Zag's positioner lose the anchor and
          rendered the popover either in the top-left of the page (or
          not at all). Separating the ref chains via a Box host means
          Tooltip gets the Box, PopoverTrigger gets the Button, and
          each finds its anchor cleanly. */}
      <Tooltip
        content={BETA_TOOLTIP}
        positioning={{ placement: "bottom" }}
        contentProps={{ maxWidth: "240px" }}
      >
        <Box display="inline-flex" marginLeft={1}>
          <PopoverRoot
            open={open}
            onOpenChange={(e) => {
              setOpen(e.open);
              if (!e.open) setName("");
            }}
            positioning={{ placement: "bottom-start" }}
          >
            <PopoverTrigger asChild>
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
            </PopoverTrigger>
            <PopoverContent width="280px">
              <PopoverBody>
                <Stack gap={3}>
                  <HStack gap={2}>
                    <Input
                      autoFocus
                      size="sm"
                      placeholder="Lens name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={handleKeyDown}
                    />
                    <Button
                      size="sm"
                      colorPalette="blue"
                      onClick={submitQuick}
                      disabled={!name.trim()}
                    >
                      Create
                    </Button>
                  </HStack>
                  {/* "Configure columns, sort, and more…" link retired in
                  Round 3 — the full-screen dialog was overkill for
                  lens creation. Columns are managed inline now (drag-
                  reorder right on the sidebar tab), sort is the
                  column-header click everyone already knows, and the
                  rest of the dialog's fields (grouping, filter text,
                  addons) are exposed elsewhere. The lens-name popover
                  is the only step that's still distinct. */}
                  <Text fontSize="2xs" color="fg.subtle" lineHeight="1.4">
                    Saved locally during beta. Won't sync across browsers yet.
                  </Text>
                </Stack>
              </PopoverBody>
            </PopoverContent>
          </PopoverRoot>
        </Box>
      </Tooltip>
    </>
  );
};
