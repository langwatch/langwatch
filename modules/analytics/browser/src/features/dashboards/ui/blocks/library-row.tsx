/**
 * One row of the `/dashboards` library: the board's name linking to it, who sees it, its owner
 * and the board's "⋮" menu (`board-menu.tsx`) with what this member may do. A From LangWatch
 * row reads "Read-only" and "LangWatch", and offers "Duplicate to edit" and a Move it cannot do.
 */

import { Box, Grid, HStack, Link as ChakraLink, Text } from "@langwatch/design-system/primitives";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";
import { InlineTextField } from "../elements/inline-text-field.tsx";
import {
  BoardMenu,
  type BoardMenuActions,
  hasBoardMenuItems,
  revealsBoardMenu,
} from "./board-menu.tsx";

/** Name, who sees it, owner, menu: the columns every row lines up on. */
const ROW_COLUMNS = "minmax(0, 1fr) 150px 96px 28px";

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
  actions: BoardMenuActions;
  renaming?: LibraryRowRenaming | undefined;
}) {
  // While renaming the menu is gone, so closing it cannot hand focus back and end the edit.
  const hasMenu = renaming === void 0 && hasBoardMenuItems(actions);
  const frame = { name, href, whoSees, isPrivate, owner, renaming };
  return <RowFrame {...frame}>{hasMenu && <BoardMenu name={name} actions={actions} />}</RowFrame>;
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
      {...revealsBoardMenu}
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
