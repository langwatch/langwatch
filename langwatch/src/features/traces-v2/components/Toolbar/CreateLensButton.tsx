import { Button, HStack, Input, Stack, Text } from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
import { LuPlus, LuSettings2 } from "react-icons/lu";
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "../../../../components/ui/popover";
import { Tooltip } from "../../../../components/ui/tooltip";
import { useFilterStore } from "../../stores/filterStore";
import { useLensDraftStore } from "../../stores/lensDraftStore";
import { useViewStore } from "../../stores/viewStore";
import { LensConfigDialog } from "./LensConfigDialog";

const BETA_TOOLTIP =
  "Lenses are saved in your browser during this beta — they don't sync across browsers or teammates yet.";

/**
 * Lens creation entry point — two paths from the same trigger:
 *   1. Quick-create popover: type a name, snapshot the current table state.
 *   2. "Configure…" link: opens `LensConfigDialog` for full setup before save.
 *
 * Both paths land in `viewStore.createLens`, which persists the new lens to
 * localStorage and switches the active tab to it.
 */
export const CreateLensButton: React.FC = () => {
  const createLens = useViewStore((s) => s.createLens);
  const openDialog = useLensDraftStore((s) => s.openDialog);
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

  const openConfigure = (): void => {
    const view = useViewStore.getState();
    const liveFilterText = useFilterStore.getState().queryText;
    openDialog({
      name: name.trim(),
      grouping: view.grouping,
      columns: view.columnOrder,
      addons: [],
      sort: view.sort,
      liveFilterText,
    });
    reset();
  };

  return (
    <>
      <PopoverRoot
        open={open}
        onOpenChange={(e) => {
          setOpen(e.open);
          if (!e.open) setName("");
        }}
      >
        <Tooltip
          content={BETA_TOOLTIP}
          positioning={{ placement: "bottom" }}
          contentProps={{ maxWidth: "240px" }}
        >
          <PopoverTrigger asChild>
            <Button
              size="xs"
              variant="ghost"
              marginLeft={1}
              minWidth="auto"
              paddingX={1}
              aria-label="Create new lens"
            >
              <LuPlus />
            </Button>
          </PopoverTrigger>
        </Tooltip>
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
              <Button
                size="xs"
                variant="ghost"
                justifyContent="flex-start"
                onClick={openConfigure}
              >
                <LuSettings2 />
                <Text marginLeft={1}>Configure columns, sort, and more…</Text>
              </Button>
              <Text fontSize="2xs" color="fg.subtle" lineHeight="1.4">
                Saved locally during beta — won't sync across browsers yet.
              </Text>
            </Stack>
          </PopoverBody>
        </PopoverContent>
      </PopoverRoot>

      <LensConfigDialog
        onCreate={(input) => {
          createLens(input.name, {
            columns: input.columns,
            addons: input.addons,
            grouping: input.grouping,
            sort: input.sort,
            filterText: input.filterText,
          });
        }}
      />
    </>
  );
};
