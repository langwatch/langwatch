/**
 * One starred board in the sidebar list: a star that unstars it, one truncated
 * line linking to the board, and a "⋮" menu (Rename, Duplicate, Move up, Move
 * down, Delete). Rename edits inline.
 */

import { Menu } from "@langwatch/design-system/menu";
import {
  Box,
  HStack,
  IconButton,
  Link as ChakraLink,
  Text,
} from "@langwatch/design-system/primitives";
import { ArrowDown, ArrowUp, Copy, MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-menu-link.tsx";
import { BoardStar } from "../elements/board-star.tsx";
import { InlineTextField } from "../elements/inline-text-field.tsx";

export type SavedDashboardRowActions = {
  isRenaming: boolean;
  onRenameStart: () => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onDuplicate: () => void;
  onUnstar: () => void;
  onDelete: () => void;
  /** Absent when the board is at the top of the member's order. */
  onMoveUp?: () => void;
  /** Absent when the board is at the bottom. */
  onMoveDown?: () => void;
};

export function SavedDashboardRow({
  name,
  href,
  isActive,
  actions,
}: {
  name: string;
  href: string;
  isActive: boolean;
  actions: SavedDashboardRowActions;
}) {
  const host = useAnalyticsHost();
  if (actions.isRenaming) {
    return <RenameField name={name} actions={actions} />;
  }

  return (
    <Box
      as="li"
      listStyleType="none"
      position="relative"
      width="full"
      _hover={{ "& .row-menu": { opacity: 1 } }}
      _focusWithin={{ "& .row-menu": { opacity: 1 } }}
    >
      <ChakraLink
        href={href}
        display="flex"
        alignItems="center"
        gap={1.5}
        width="full"
        borderRadius="lg"
        paddingX={2}
        paddingY="3px"
        fontSize="13px"
        fontWeight={isActive ? "medium" : "normal"}
        color={isActive ? "fg" : "fg.subtle"}
        background={isActive ? "border" : "transparent"}
        textDecoration="none"
        _hover={{ color: "fg", background: isActive ? "border" : "border/50" }}
        aria-current={isActive ? "page" : void 0}
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          host.navigate(href);
        }}
      >
        <Box as="span" display="flex" flexShrink={0}>
          <BoardStar isStarred onToggle={actions.onUnstar} size={14} />
        </Box>
        <Text as="span" truncate minWidth={0}>
          {name}
        </Text>
        <Box width="24px" flexShrink={0} marginLeft="auto" />
      </ChakraLink>
      <RowMenu name={name} isActive={isActive} actions={actions} />
    </Box>
  );
}

/** A plain row with no star and no reorder, for the "All dashboards" link. */
export function SavedDashboardLink({
  name,
  href,
  icon,
  isActive,
}: {
  name: string;
  href: string;
  icon: ReactNode;
  isActive: boolean;
}) {
  const host = useAnalyticsHost();
  return (
    <Box as="li" listStyleType="none" width="full">
      <ChakraLink
        href={href}
        display="flex"
        alignItems="center"
        gap={2.5}
        width="full"
        borderRadius="lg"
        paddingX={2}
        paddingY="5px"
        fontSize="13px"
        fontWeight={isActive ? "medium" : "normal"}
        color={isActive ? "fg" : "fg.subtle"}
        background={isActive ? "border" : "transparent"}
        textDecoration="none"
        _hover={{ color: "fg", background: isActive ? "border" : "border/50" }}
        aria-current={isActive ? "page" : void 0}
        onClick={(event) => {
          if (opensElsewhere(event)) return;
          event.preventDefault();
          host.navigate(href);
        }}
      >
        <Box as="span" display="flex" flexShrink={0}>
          {icon}
        </Box>
        <Text as="span" truncate minWidth={0}>
          {name}
        </Text>
      </ChakraLink>
    </Box>
  );
}

function RowMenu({
  name,
  isActive,
  actions,
}: {
  name: string;
  isActive: boolean;
  actions: SavedDashboardRowActions;
}) {
  return (
    <Box
      className="row-menu"
      position="absolute"
      right={1}
      top="50%"
      transform="translateY(-50%)"
      display="flex"
      opacity={isActive ? 1 : 0}
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
        <Menu.Content minWidth="188px">
          <Menu.Item value="rename" onClick={actions.onRenameStart}>
            <MenuRow icon={<Pencil size={13} />}>Rename</MenuRow>
          </Menu.Item>
          <Menu.Item value="duplicate" onClick={actions.onDuplicate}>
            <MenuRow icon={<Copy size={13} />}>Duplicate</MenuRow>
          </Menu.Item>
          <Menu.Item value="move-up" disabled={!actions.onMoveUp} onClick={actions.onMoveUp}>
            <MenuRow icon={<ArrowUp size={13} />}>Move up</MenuRow>
          </Menu.Item>
          <Menu.Item value="move-down" disabled={!actions.onMoveDown} onClick={actions.onMoveDown}>
            <MenuRow icon={<ArrowDown size={13} />}>Move down</MenuRow>
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item value="delete" color="red.fg" onClick={actions.onDelete}>
            <MenuRow icon={<Trash2 size={13} />}>Delete</MenuRow>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </Box>
  );
}

function MenuRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <HStack width="full" gap={2} fontSize="12.5px">
      <Box as="span" display="flex" flexShrink={0}>
        {icon}
      </Box>
      <Text as="span" flex="1">
        {children}
      </Text>
    </HStack>
  );
}

function RenameField({ name, actions }: { name: string; actions: SavedDashboardRowActions }) {
  return (
    <Box as="li" listStyleType="none" width="full" paddingX={1}>
      <InlineTextField
        value={name}
        label="Dashboard name"
        size="xs"
        fontSize="13px"
        onCancel={actions.onRenameCancel}
        onCommit={(draft) => {
          const trimmed = draft.trim();
          if (trimmed && trimmed !== name) actions.onRenameCommit(trimmed);
          else actions.onRenameCancel();
        }}
      />
    </Box>
  );
}
