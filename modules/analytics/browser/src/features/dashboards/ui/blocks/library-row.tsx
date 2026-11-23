/**
 * One row of the `/dashboards` library: the board's name linking to it, who sees it, its owner
 * and a "⋮" menu with what this member may do. A From LangWatch row reads "Read-only" and
 * "LangWatch", and offers "Duplicate to edit" and a Move it cannot do.
 */

import { Menu } from "@langwatch/design-system/menu";
import {
  Box,
  Grid,
  HStack,
  IconButton,
  Link as ChakraLink,
  Text,
} from "@langwatch/design-system/primitives";
import { Copy, FolderInput, Lock, MoreVertical, Pencil, Sparkles, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";
import { InlineTextField } from "../elements/inline-text-field.tsx";

/** Name, who sees it, owner, menu: the columns every row lines up on. */
const ROW_COLUMNS = "minmax(0, 1fr) 150px 96px 28px";

/** "Move to product…": `onMove` where the member may move it, else why not, shown disabled. */
export type LibraryRowMove = { onMove: () => void } | { refusal: string };

/** What the menu offers; an entry left out is not shown. */
export type LibraryRowActions = {
  onRename?: () => void;
  move?: LibraryRowMove;
  onDuplicate?: () => void;
  /** "Duplicate to edit" on a row the member cannot edit. */
  duplicateLabel?: string;
  /** `onDelete` is absent for My dashboard, whose Delete shows disabled. */
  remove?: { onDelete?: () => void };
};

/** The name edited in place: Enter or leaving the field saves it, Escape cancels. */
export type LibraryRowRenaming = { onCommit: (name: string) => void; onCancel: () => void };

export function LibraryRow({
  name,
  href,
  whoSees,
  isPrivate = false,
  owner,
  actions,
  renaming,
}: {
  name: string;
  /** Absent when no project the member reads can open the board. */
  href: string | undefined;
  whoSees: string;
  isPrivate?: boolean;
  owner: string | undefined;
  actions: LibraryRowActions;
  renaming?: LibraryRowRenaming | undefined;
}) {
  const { onRename, move, onDuplicate, duplicateLabel = "Duplicate", remove } = actions;
  // While renaming the menu is gone, so closing it cannot hand focus back and end the edit.
  const hasMenu =
    renaming === void 0 && [onRename, move, onDuplicate, remove].some((entry) => entry !== void 0);
  const frame = { name, href, whoSees, isPrivate, owner, renaming };
  return (
    <RowFrame {...frame}>
      {hasMenu && (
        <RowMenu name={name}>
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
        </RowMenu>
      )}
    </RowFrame>
  );
}

/**
 * A From LangWatch board: live and read-only, so a copy is the one thing to make of it. Its
 * Move shows disabled, saying why (`moveRefusal`), so the member learns to move a copy.
 */
export function CuratedLibraryRow({
  name,
  href,
  onDuplicate,
  moveRefusal,
}: {
  name: string;
  href: string | undefined;
  onDuplicate?: () => void;
  moveRefusal: string;
}) {
  return (
    <RowFrame name={name} href={href} whoSees="Read-only" owner="LangWatch">
      <RowMenu name={name}>
        <MoveItem move={{ refusal: moveRefusal }} />
        {onDuplicate && (
          <Menu.Item value="duplicate" onClick={onDuplicate}>
            <MenuRow icon={<Sparkles size={13} />}>Duplicate to edit</MenuRow>
          </Menu.Item>
        )}
      </RowMenu>
    </RowFrame>
  );
}

function MoveItem({ move }: { move: LibraryRowMove }) {
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

function RowFrame({
  name,
  href,
  whoSees,
  isPrivate = false,
  owner,
  renaming,
  children,
}: {
  name: string;
  href: string | undefined;
  whoSees: string;
  isPrivate?: boolean;
  owner: string | undefined;
  renaming?: LibraryRowRenaming | undefined;
  children: ReactNode;
}) {
  return (
    <Grid
      as="li"
      listStyleType="none"
      templateColumns={ROW_COLUMNS}
      alignItems="center"
      gap={3}
      paddingX={3}
      paddingY={2}
      textStyle="bodySm"
      _hover={{ "& .row-menu": { opacity: 1 } }}
      _focusWithin={{ "& .row-menu": { opacity: 1 } }}
    >
      {renaming ? (
        <InlineTextField
          value={name}
          label="Dashboard name"
          size="xs"
          textStyle="bodySm"
          onCommit={renaming.onCommit}
          onCancel={renaming.onCancel}
        />
      ) : (
        <NameCell name={name} href={href} />
      )}
      <HStack gap={1} minWidth={0} color="fg.muted" textStyle="caption">
        {isPrivate && <Lock size={11} aria-label="Only me" />}
        <Text as="span" truncate title={whoSees}>
          {whoSees}
        </Text>
      </HStack>
      <Text truncate color="fg.muted" textStyle="caption">
        {owner}
      </Text>
      <Box>{children}</Box>
    </Grid>
  );
}

/** The board's name, a link where it opens and plain text where it opens nowhere. */
function NameCell({ name, href }: { name: string; href: string | undefined }) {
  const host = useAnalyticsHost();
  if (!href) {
    return (
      <Text truncate fontWeight="medium" color="fg">
        {name}
      </Text>
    );
  }
  return (
    <ChakraLink
      href={href}
      display="block"
      minWidth={0}
      overflow="hidden"
      textOverflow="ellipsis"
      whiteSpace="nowrap"
      title={name}
      fontWeight="medium"
      color="fg"
      onClick={(event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        host.navigate(href);
      }}
    >
      {name}
    </ChakraLink>
  );
}

function RowMenu({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Box
      className="row-menu"
      display="flex"
      opacity={0}
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
