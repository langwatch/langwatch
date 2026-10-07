/**
 * One board on the All dashboards page: a star, the name as a link, its
 * description, who made it and when it last changed, and a row menu (Rename,
 * Duplicate, Delete). Rename edits inline.
 */

import { Menu } from "@langwatch/design-system/menu";
import {
  Box,
  HStack,
  IconButton,
  Link as ChakraLink,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Temporal, toDate } from "@langwatch/time";
import { Copy, MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-menu-link.tsx";
import type { SavedBoard } from "../../behavior/use-saved-dashboards.ts";
import { BoardStar } from "../elements/board-star.tsx";
import { InlineTextField } from "../elements/inline-text-field.tsx";

const UPDATED_FORMAT = new Intl.DateTimeFormat(void 0, { dateStyle: "medium" });

/** The wire's ISO timestamp, formatted without minting a Date (temporal-only). */
function formatUpdated(iso: string): string {
  return UPDATED_FORMAT.format(toDate(Temporal.Instant.from(iso)));
}

export type AllDashboardsRowActions = {
  isRenaming: boolean;
  onRenameStart: () => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onToggleStar: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export function AllDashboardsRow({
  board,
  href,
  currentUserId,
  actions,
}: {
  board: SavedBoard;
  href: string;
  currentUserId: string | undefined;
  actions: AllDashboardsRowActions;
}) {
  const host = useAnalyticsHost();
  if (actions.isRenaming) {
    return (
      <Box as="li" listStyleType="none" paddingX={3} paddingY={2}>
        <InlineTextField
          value={board.name}
          label="Dashboard name"
          size="sm"
          onCancel={actions.onRenameCancel}
          onCommit={(draft) => {
            const trimmed = draft.trim();
            if (trimmed && trimmed !== board.name) actions.onRenameCommit(trimmed);
            else actions.onRenameCancel();
          }}
        />
      </Box>
    );
  }

  return (
    <HStack
      as="li"
      listStyleType="none"
      gap={3}
      paddingX={3}
      paddingY={2.5}
      borderTopWidth="1px"
      borderColor="border.muted"
      _hover={{ background: "bg.muted", "& .row-menu": { opacity: 1 } }}
    >
      <BoardStar isStarred={board.isStarred} onToggle={actions.onToggleStar} />
      <VStack align="start" gap={0.5} flex={1} minWidth={0}>
        <ChakraLink
          href={href}
          fontSize="14px"
          fontWeight="medium"
          color="fg"
          textDecoration="none"
          _hover={{ textDecoration: "underline" }}
          onClick={(event) => {
            if (opensElsewhere(event)) return;
            event.preventDefault();
            host.navigate(href);
          }}
        >
          {board.name}
        </ChakraLink>
        {board.description && (
          <Text fontSize="12.5px" color="fg.muted" truncate maxWidth="full">
            {board.description}
          </Text>
        )}
      </VStack>
      <Text
        fontSize="12px"
        color="fg.subtle"
        flexShrink={0}
        display={{ base: "none", md: "block" }}
      >
        {createdByLabel({ createdById: board.createdById, currentUserId })}
      </Text>
      <Text
        fontSize="12px"
        color="fg.subtle"
        flexShrink={0}
        minWidth="92px"
        textAlign="end"
        display={{ base: "none", sm: "block" }}
      >
        {formatUpdated(board.updatedAt)}
      </Text>
      <RowMenu name={board.name} actions={actions} />
    </HStack>
  );
}

/** No member directory here, so a teammate's board reads as "a teammate". */
function createdByLabel({
  createdById,
  currentUserId,
}: {
  createdById: string | null;
  currentUserId: string | undefined;
}): string {
  if (createdById === null) return "";
  if (createdById === currentUserId) return "Created by you";
  return "Created by a teammate";
}

function RowMenu({ name, actions }: { name: string; actions: AllDashboardsRowActions }) {
  return (
    <Box className="row-menu" flexShrink={0} opacity={0} transition="opacity 0.15s">
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton
            size="xs"
            variant="ghost"
            color="fg.subtle"
            _hover={{ color: "fg", background: "bg.muted" }}
            aria-label={`Actions for ${name}`}
          >
            <MoreVertical size={15} aria-hidden />
          </IconButton>
        </Menu.Trigger>
        <Menu.Content minWidth="180px">
          <Menu.Item value="rename" onClick={actions.onRenameStart}>
            <MenuRow icon={<Pencil size={13} />}>Rename</MenuRow>
          </Menu.Item>
          <Menu.Item value="duplicate" onClick={actions.onDuplicate}>
            <MenuRow icon={<Copy size={13} />}>Duplicate</MenuRow>
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
