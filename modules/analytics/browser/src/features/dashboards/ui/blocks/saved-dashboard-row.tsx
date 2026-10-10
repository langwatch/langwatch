/**
 * One board in the Dashboards sidebar: a star that toggles it, one truncated line linking to
 * it with its scope mark, and a "⋮" menu. A stored board offers Star and its order, then what
 * this reader may do with it; a From LangWatch board offers Star and Duplicate to edit.
 */

import type { DashboardScope } from "@langwatch/dashboard-contract";
import { Menu } from "@langwatch/design-system/menu";
import {
  Box,
  HStack,
  IconButton,
  Link as ChakraLink,
  Text,
} from "@langwatch/design-system/primitives";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  MoreVertical,
  Pencil,
  Sparkles,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";
import type { ScopeNames } from "../../model/board-scope.ts";
import { BoardStar } from "../elements/board-star.tsx";
import { InlineTextField } from "../elements/inline-text-field.tsx";
import { ScopeChoices } from "./board-scope-control.tsx";

/** Star and order, shared by both kinds of row. */
export type StarActions = {
  isStarred: boolean;
  onToggleStar: () => void;
  /** Only while starred; each side absent at the end of the list it faces. */
  move?: { onMoveUp?: () => void; onMoveDown?: () => void };
};

/**
 * What the menu offers below the star. An entry left out is not shown: a reader who cannot
 * edit the board sees no Rename and no Delete, and only its author sees its scope.
 */
export type SavedDashboardRowActions = StarActions & {
  isRenaming: boolean;
  /** The three scope choices, for the author in the project that owns the board. */
  scope?: { value: DashboardScope; names: ScopeNames; onPick: (scope: DashboardScope) => void };
  /** `onStart` is absent for My dashboard, whose name marks it as the member's own. */
  rename?: { onStart?: () => void };
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  /** "Duplicate", or "Duplicate to edit" on a board this reader cannot edit. */
  duplicate?: { label: string; onDuplicate: () => void };
  /** `onDelete` is absent for My dashboard, which cannot be deleted. */
  remove?: { onDelete?: () => void };
};

export function SavedDashboardRow({
  name,
  href,
  isActive,
  mark,
  actions,
}: {
  name: string;
  href: string;
  isActive: boolean;
  /** The scope mark after the name: a lock or a building, none on a Project board. */
  mark?: ReactNode;
  actions: SavedDashboardRowActions;
}) {
  if (actions.isRenaming) return <RenameField name={name} actions={actions} />;
  const { scope, rename, duplicate, remove } = actions;
  return (
    <SidebarRow name={name} href={href} isActive={isActive} star={actions} mark={mark}>
      <StarItems name={name} actions={actions} />
      {scope && (
        <>
          <Menu.Separator />
          <ScopeChoices scope={scope.value} names={scope.names} onPick={scope.onPick} />
        </>
      )}
      {(rename || duplicate) && <Menu.Separator />}
      {rename && (
        <Menu.Item value="rename" disabled={!rename.onStart} onClick={rename.onStart}>
          <MenuRow icon={<Pencil size={13} />}>Rename</MenuRow>
        </Menu.Item>
      )}
      {duplicate && (
        <Menu.Item value="duplicate" onClick={duplicate.onDuplicate}>
          <MenuRow icon={<Copy size={13} />}>{duplicate.label}</MenuRow>
        </Menu.Item>
      )}
      {remove && (
        <>
          <Menu.Separator />
          <Menu.Item
            value="delete"
            color={remove.onDelete ? "red.fg" : void 0}
            disabled={!remove.onDelete}
            title={remove.onDelete ? void 0 : "Your own dashboard can't be deleted"}
            onClick={remove.onDelete}
          >
            <MenuRow icon={<Trash2 size={13} />}>Delete</MenuRow>
          </Menu.Item>
        </>
      )}
    </SidebarRow>
  );
}

/** A From LangWatch board: a live template, so nothing to rename or delete. */
export function CuratedDashboardRow({
  name,
  href,
  isActive,
  actions,
}: {
  name: string;
  href: string;
  isActive: boolean;
  actions: StarActions & { onDuplicate: () => void };
}) {
  return (
    <SidebarRow name={name} href={href} isActive={isActive} star={actions}>
      <StarItems name={name} actions={actions} />
      <Menu.Item value="duplicate" onClick={actions.onDuplicate}>
        <MenuRow icon={<Sparkles size={13} />}>Duplicate to edit</MenuRow>
      </Menu.Item>
    </SidebarRow>
  );
}

function StarItems({ name, actions }: { name: string; actions: StarActions }) {
  return (
    <>
      <Menu.Item value="star" onClick={actions.onToggleStar}>
        <MenuRow icon={actions.isStarred ? <StarOff size={13} /> : <Star size={13} />}>
          {actions.isStarred ? "Unstar" : "Star"}
        </MenuRow>
      </Menu.Item>
      {actions.move && (
        <>
          <Menu.Item
            value="move-up"
            aria-label={`Move ${name} up`}
            disabled={!actions.move.onMoveUp}
            onClick={actions.move.onMoveUp}
          >
            <MenuRow icon={<ArrowUp size={13} />}>Move up</MenuRow>
          </Menu.Item>
          <Menu.Item
            value="move-down"
            aria-label={`Move ${name} down`}
            disabled={!actions.move.onMoveDown}
            onClick={actions.move.onMoveDown}
          >
            <MenuRow icon={<ArrowDown size={13} />}>Move down</MenuRow>
          </Menu.Item>
        </>
      )}
    </>
  );
}

function SidebarRow({
  name,
  href,
  isActive,
  star,
  mark,
  children,
}: {
  name: string;
  href: string;
  isActive: boolean;
  star: StarActions;
  mark?: ReactNode;
  /** The menu's items. */
  children: ReactNode;
}) {
  const host = useAnalyticsHost();
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
          <BoardStar isStarred={star.isStarred} onToggle={star.onToggleStar} size={14} />
        </Box>
        <Text as="span" truncate minWidth={0}>
          {name}
        </Text>
        {mark}
        <Box width="24px" flexShrink={0} marginLeft="auto" />
      </ChakraLink>
      <Box
        className="row-menu"
        position="absolute"
        right={1}
        top="50%"
        transform="translateY(-50%)"
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
