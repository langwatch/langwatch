/**
 * The button left of a board's title and the popover it opens: a searchable grid of the
 * allow-listed icons and "Remove icon". Arrow keys move through the grid; Escape closes it.
 * @see modules/dashboard/specs/dashboard-icons.feature
 */

import type { DashboardIcon } from "@langwatch/dashboard-contract";
import { Popover } from "@langwatch/design-system/popover";
import {
  Box,
  Button,
  IconButton,
  Input,
  SimpleGrid,
  Text,
} from "@langwatch/design-system/primitives";
import { LayoutDashboard } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";

import {
  BOARD_ICON_COLUMNS,
  boardIconLabel,
  nextBoardIconIndex,
  searchBoardIcons,
} from "../../model/board-icons.ts";
import { BOARD_ICON_GLYPHS, BoardIconGlyph } from "../elements/board-icon-glyph.tsx";

const TITLE_ICON_SIZE = 22;
const GRID_ICON_SIZE = 16;

/** The board's icon beside its title where the reader may not change it. */
export function BoardTitleIcon({ icon }: { icon: DashboardIcon }) {
  return (
    <Box as="span" display="flex" flexShrink={0} color="fg.muted" title={boardIconLabel(icon)}>
      <BoardIconGlyph icon={icon} size={TITLE_ICON_SIZE} fallback={null} />
    </Box>
  );
}

export function BoardIconPicker({
  icon,
  onPick,
}: {
  icon: DashboardIcon | null;
  /** `null` is "Remove icon": the board goes back to the default glyph. */
  onPick: (icon: DashboardIcon | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const matches = searchBoardIcons({ query });

  const pick = (next: DashboardIcon | null) => {
    setOpen(false);
    setQuery("");
    onPick(next);
  };
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(grid.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const next = nextBoardIconIndex({ index, key: event.key, count: buttons.length });
    if (index < 0 || next === index) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <Popover.Root
      positioning={{ placement: "bottom-start" }}
      open={open}
      onOpenChange={({ open: next }) => setOpen(next)}
      initialFocusEl={() => search.current}
    >
      <Popover.Trigger asChild>
        <IconButton
          variant="ghost"
          size="sm"
          color="fg.muted"
          aria-label="Change icon"
          title="Change icon"
          data-board-icon-button
        >
          <BoardIconGlyph
            icon={icon}
            size={TITLE_ICON_SIZE}
            fallback={<LayoutDashboard size={TITLE_ICON_SIZE} aria-hidden />}
          />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content width="auto" padding={2}>
        <Popover.Body padding={0}>
          <Input
            ref={search}
            size="sm"
            aria-label="Search icons"
            placeholder="Search icons"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            marginBottom={2}
          />
          {matches.length === 0 ? (
            <Text textStyle="bodySm" color="fg.muted" paddingY={2}>
              No icons match
            </Text>
          ) : (
            <Box as="fieldset" aria-label="Icons" border={0} margin={0} padding={0} minWidth={0}>
              <SimpleGrid
                ref={grid}
                columns={BOARD_ICON_COLUMNS}
                gap={1}
                maxHeight="240px"
                overflowY="auto"
                onKeyDown={moveFocus}
              >
                {matches.map((name) => {
                  const Glyph = BOARD_ICON_GLYPHS[name];
                  return (
                    <IconButton
                      key={name}
                      size="sm"
                      variant={name === icon ? "subtle" : "ghost"}
                      aria-label={boardIconLabel(name)}
                      aria-pressed={name === icon}
                      title={boardIconLabel(name)}
                      onClick={() => pick(name)}
                    >
                      <Glyph size={GRID_ICON_SIZE} aria-hidden />
                    </IconButton>
                  );
                })}
              </SimpleGrid>
            </Box>
          )}
          {icon !== null && (
            <Button
              variant="ghost"
              size="xs"
              width="full"
              marginTop={2}
              justifyContent="flex-start"
              onClick={() => pick(null)}
            >
              Remove icon
            </Button>
          )}
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
