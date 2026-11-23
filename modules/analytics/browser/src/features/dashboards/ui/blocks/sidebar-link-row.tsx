/**
 * A link row in a sidebar list: a board or "Browse templates". A board's row may carry its "⋮"
 * menu, drawn over the row's right end only while the row is hovered, focused or the menu open,
 * so the row looks the same otherwise; and while renamed, the name is a field in its place.
 */

import { Box, Link as ChakraLink, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";
import { InlineTextField } from "../elements/inline-text-field.tsx";
import { revealsBoardMenu } from "./board-menu.tsx";

/** A row with a menu: it shows the menu, and the name gives up the menu's room while it shows. */
const MENU_ROW = {
  ...revealsBoardMenu,
  css: {
    "&:hover > a, &:focus-within > a, &:has([aria-expanded=true]) > a": { paddingRight: "28px" },
  },
};

/** The name edited in place: Enter or leaving the field saves it, Escape cancels. */
export type SidebarRowRenaming = { onCommit: (name: string) => void; onCancel: () => void };

export function SidebarLinkRow({
  name,
  href,
  icon,
  iconTitle,
  isActive = false,
  menu,
  renaming,
}: {
  name: string;
  href: string;
  /** Drawn before the name, as navigation's own entries draw theirs. */
  icon?: ReactNode;
  /** What the icon says on hover, such as who sees the board. */
  iconTitle?: string;
  /** The page the reader is on, marked as navigation marks its own entries. */
  isActive?: boolean;
  /** A board's `BoardMenu`, beside the link rather than in it, so opening it never navigates. */
  menu?: ReactNode;
  renaming?: SidebarRowRenaming | undefined;
}) {
  if (renaming) {
    return (
      <Box as="li" listStyleType="none" width="full" paddingX={1} paddingY="2px">
        <InlineTextField
          value={name}
          label="Dashboard name"
          size="xs"
          textStyle="bodySm"
          onCommit={renaming.onCommit}
          onCancel={renaming.onCancel}
        />
      </Box>
    );
  }
  return (
    <Box as="li" listStyleType="none" width="full" position="relative" {...(menu ? MENU_ROW : {})}>
      <RowLink name={name} href={href} icon={icon} iconTitle={iconTitle} isActive={isActive} />
      {menu && (
        <Box position="absolute" top={0} bottom={0} right={1} display="flex" alignItems="center">
          {menu}
        </Box>
      )}
    </Box>
  );
}

function RowLink({
  name,
  href,
  icon,
  iconTitle,
  isActive,
}: {
  name: string;
  href: string;
  icon: ReactNode;
  iconTitle: string | undefined;
  isActive: boolean;
}) {
  const host = useAnalyticsHost();
  return (
    <ChakraLink
      href={href}
      aria-current={isActive ? "page" : void 0}
      display="flex"
      alignItems="center"
      gap={2}
      width="full"
      borderRadius="lg"
      paddingX={2}
      paddingY="4px"
      textStyle="bodySm"
      color={isActive ? "fg" : "fg.subtle"}
      fontWeight={isActive ? "medium" : void 0}
      background={isActive ? "border" : void 0}
      textDecoration="none"
      _hover={{ color: "fg", background: isActive ? "border" : "border/50" }}
      onClick={(event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        host.navigate(href);
      }}
    >
      {icon && (
        <Box as="span" display="flex" flexShrink={0} title={iconTitle} aria-hidden>
          {icon}
        </Box>
      )}
      {/* A long name is clipped with an ellipsis and read in full on hover. */}
      <Text as="span" truncate minWidth={0} title={name}>
        {name}
      </Text>
    </ChakraLink>
  );
}
