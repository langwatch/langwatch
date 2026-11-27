/**
 * A board's "⋮" menu with what this member may do: Rename, Move to product…, Duplicate and
 * Delete. The library's rows and the product sidebars' rows draw the same one. It stays hidden
 * until its row is hovered or holds keyboard focus (`revealsBoardMenu`), and while it is open.
 */

import { Menu } from "@langwatch/design-system/menu";
import { Box, HStack, IconButton, Text } from "@langwatch/design-system/primitives";
import { Copy, FolderInput, MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import type { BoardMenuActions, BoardMenuMove } from "../../model/organization-library.ts";

/**
 * Spread on the row that holds the menu, so hovering or keyboard focus in the row shows it.
 * Not `:focus-within`: a clicked link keeps focus after navigating, so the open row kept its "⋮".
 */
export const revealsBoardMenu = {
  css: { "&:hover .board-menu, &:has(:focus-visible) .board-menu": { opacity: 1 } },
};

export function BoardMenu({
  name,
  actions,
  isAlwaysShown = false,
}: {
  name: string;
  actions: BoardMenuActions;
  /** A table row shows its "⋮" at rest; a sidebar row only on hover or focus. */
  isAlwaysShown?: boolean;
}) {
  const { onRename, move, onDuplicate, duplicateLabel = "Duplicate", remove } = actions;
  return (
    <MenuFrame name={name} isAlwaysShown={isAlwaysShown}>
      {onRename && (
        <Menu.Item value="rename" onClick={onRename}>
          <MenuRow icon={<Pencil size={13} />}>Rename</MenuRow>
        </Menu.Item>
      )}
      {move && <MoveItem move={move} />}
      {onDuplicate && (
        <Menu.Item value="duplicate" onClick={onDuplicate}>
          <MenuRow icon={<Copy size={13} />}>{duplicateLabel}</MenuRow>
        </Menu.Item>
      )}
      {remove && (
        <>
          <Menu.Separator />
          <DeleteItem onDelete={remove.onDelete} />
        </>
      )}
    </MenuFrame>
  );
}

function MoveItem({ move }: { move: BoardMenuMove }) {
  const onMove = "onMove" in move ? move.onMove : void 0;
  return (
    <Menu.Item
      value="move"
      disabled={!onMove}
      title={"refusal" in move ? move.refusal : void 0}
      onClick={onMove}
    >
      <MenuRow icon={<FolderInput size={13} />}>Move to product…</MenuRow>
    </Menu.Item>
  );
}

function DeleteItem({ onDelete }: { onDelete: (() => void) | undefined }) {
  return (
    <Menu.Item
      value="delete"
      color={onDelete ? "red.fg" : void 0}
      disabled={!onDelete}
      title={onDelete ? void 0 : "Your default dashboard can't be deleted"}
      onClick={onDelete}
    >
      <MenuRow icon={<Trash2 size={13} />}>Delete</MenuRow>
    </Menu.Item>
  );
}

function MenuFrame({
  name,
  isAlwaysShown,
  children,
}: {
  name: string;
  isAlwaysShown: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      className="board-menu"
      display="flex"
      opacity={isAlwaysShown ? 1 : 0}
      transition="opacity 0.2s"
      css={{ "&:has([aria-expanded=true])": { opacity: 1 } }}
    >
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton
            size="xs"
            variant="ghost"
            color="fg.subtle"
            _hover={{ color: "fg", background: "bg.muted" }}
            aria-label={`Actions for ${name}`}
          >
            <MoreVertical size={14} aria-hidden />
          </IconButton>
        </Menu.Trigger>
        <Menu.Content minWidth="188px">{children}</Menu.Content>
      </Menu.Root>
    </Box>
  );
}

function MenuRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <HStack width="full" gap={2} textStyle="bodySm">
      <Box as="span" display="flex" flexShrink={0}>
        {icon}
      </Box>
      <Text as="span" flex="1">
        {children}
      </Text>
    </HStack>
  );
}
