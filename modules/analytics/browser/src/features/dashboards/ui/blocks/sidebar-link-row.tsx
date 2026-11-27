/**
 * A link row in a sidebar list: a board or "Browse templates". A board's row may carry its "⋮"
 * menu, drawn over the row's right end only while the row is hovered, keyboard-focused or its menu
 * open, so the row looks the same otherwise; and while renamed, the name is a field in its place.
 */

import { Box, Link as ChakraLink, Text } from "@langwatch/design-system/primitives";
import type { CSSProperties, PointerEventHandler, ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";
import { InlineTextField } from "../elements/inline-text-field.tsx";
import { revealsBoardMenu } from "./board-menu.tsx";

/** The icon edge navigation's entries draw at the sidebar's compact density. */
export const SIDEBAR_ROW_ICON_SIZE = 15;

/**
 * Navigation's own entry at the compact density the product sidebar draws (its side-menu-link
 * and side-menu-density): 29px tall, 8px aside, 10px gap, bodySm, `nav.*` ink and fills. Matched
 * by token, since analytics may not import navigation's browser package.
 */
export function sidebarRowLook({ isActive }: { isActive: boolean }) {
  return {
    display: "flex",
    alignItems: "center",
    height: "29px",
    gap: 2.5,
    paddingX: 2,
    borderRadius: "lg",
    textStyle: "bodySm",
    fontWeight: isActive ? "medium" : "normal",
    color: isActive ? "fg" : "nav.fg",
    background: isActive ? "nav.bgActive" : "transparent",
    textDecoration: "none",
    transition: "background-color 0.15s ease-in-out",
    _hover: { background: "nav.bgHover" },
  } as const;
}

/** The icon's ink beside the name, as navigation inks its own entries' icons. */
export function sidebarRowIconColor({ isActive }: { isActive: boolean }): string {
  return isActive ? "fg" : "nav.fgMuted";
}

/** A row with a menu: it shows the menu, and the name gives up the menu's room while it shows. */
const MENU_ROW = {
  css: {
    ...revealsBoardMenu.css,
    "&:hover > a, &:has(:focus-visible) > a, &:has([aria-expanded=true]) > a": {
      paddingRight: "28px",
    },
  },
};

/**
 * A row the reader may drag: the list's sortable ref and motion, the pointer start on the whole
 * row, and the keyboard `handle`, drawn over the icon while the row is hovered or the handle has
 * focus.
 */
export type SidebarRowDrag = {
  ref: (node: HTMLElement | null) => void;
  style: CSSProperties;
  onPointerDown: PointerEventHandler<HTMLElement> | undefined;
  handle: ReactNode;
};

/** The handle replaces the icon while the row is hovered, or while the handle has focus. */
const DRAG_ROW = {
  "&:hover [data-row-icon], &:has([data-drag-handle]:focus-visible) [data-row-icon]": {
    opacity: 0,
  },
  "&:hover [data-drag-handle], & [data-drag-handle]:focus-visible": { opacity: 1 },
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
  drag,
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
  /** Makes the row draggable in a sortable list; absent on a row that stays in place. */
  drag?: SidebarRowDrag | undefined;
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
  const { handle, ...dragRow } = drag ?? {};
  const css = { ...(menu ? MENU_ROW.css : {}), ...(drag ? DRAG_ROW : {}) };
  return (
    <Box as="li" listStyleType="none" width="full" position="relative" css={css} {...dragRow}>
      <RowLink name={name} href={href} icon={icon} iconTitle={iconTitle} isActive={isActive} />
      {handle && (
        <Box position="absolute" top={0} bottom={0} left="4px" display="flex" alignItems="center">
          {handle}
        </Box>
      )}
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
      width="full"
      {...sidebarRowLook({ isActive })}
      onClick={(event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        host.navigate(href);
      }}
    >
      {icon && (
        <Box
          as="span"
          display="flex"
          flexShrink={0}
          color={sidebarRowIconColor({ isActive })}
          title={iconTitle}
          transition="opacity 0.15s"
          data-row-icon=""
          aria-hidden
        >
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
