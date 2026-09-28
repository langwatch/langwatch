/**
 * One board in the saved-dashboards list, after the prototype's sidebar row:
 * one truncated line, an optional tag, and for a board the member owns a "⋮"
 * menu. Rename swaps in an inline field; Enter or blur saves, Escape cancels.
 */

import { Box, Button, Link as ChakraLink, Text } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { MoreVertical } from "lucide-react";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-menu-link.tsx";
import { InlineTextField } from "../elements/inline-text-field.tsx";

export type SavedDashboardRowActions = {
  isRenaming: boolean;
  onRenameStart: () => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  /** Absent for a member who may not delete the board (AC26). */
  onDelete?: () => void;
};

export function SavedDashboardRow({
  name,
  href,
  icon,
  isActive,
  tag,
  actions,
}: {
  name: string;
  href: string;
  icon: ReactNode;
  isActive: boolean;
  tag?: string;
  actions?: SavedDashboardRowActions;
}) {
  const host = useAnalyticsHost();
  if (actions?.isRenaming) {
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
        {tag && <RowTag>{tag}</RowTag>}
        {!tag && actions && <Box width="20px" flexShrink={0} marginLeft="auto" />}
      </ChakraLink>
      {actions && <RowMenu name={name} isActive={isActive} actions={actions} />}
    </Box>
  );
}

function RowTag({ children }: { children: string }) {
  return (
    <Box
      as="span"
      marginLeft="auto"
      flexShrink={0}
      borderRadius="sm"
      background="bg.muted"
      paddingX={1}
      paddingY={0.5}
      fontSize="9px"
      fontWeight="semibold"
      letterSpacing="wide"
      textTransform="uppercase"
      color="gray.400"
    >
      {children}
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
      opacity={isActive ? 1 : 0}
      transition="opacity 0.2s"
    >
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button size="2xs" variant="ghost" color="gray.400" aria-label={`Actions for ${name}`}>
            <MoreVertical size={14} />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item value="rename" onClick={actions.onRenameStart}>
            Rename
          </Menu.Item>
          {actions.onDelete && (
            <Menu.Item value="delete" color="red.500" onClick={actions.onDelete}>
              Delete
            </Menu.Item>
          )}
        </Menu.Content>
      </Menu.Root>
    </Box>
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
