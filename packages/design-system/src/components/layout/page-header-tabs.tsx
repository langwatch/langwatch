/**
 * Routed tabs in a page header: each tab is a link, the current one marked by `aria-current`
 * and a 2px underline on the header's bottom border. They read no route; the page hands
 * `activeHref` and `onNavigate`. Left-aligned after the heading; actions stay on the right.
 */
import { Box, chakra, Link } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { MenuContent, MenuRoot, MenuTrigger } from "../overlays/menu.tsx";
import { TabCount } from "../values/tab-count.tsx";
import { isBrowserClick } from "./back-link.tsx";

/** One header tab: where it goes and how it reads. */
export type PageTab = {
  label: string;
  href: string;
  /** Trailing count, drawn by TabCount; undefined while it is still being read. */
  count?: number;
  testId?: string;
};

/** The shared look of a header tab; the underline is a pseudo-element, so marking moves nothing. */
const TAB_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 1.5,
  height: "full",
  paddingX: 3,
  fontSize: "13px",
  lineHeight: "20px",
  whiteSpace: "nowrap",
  position: "relative",
  background: "transparent",
  cursor: "pointer",
  transition: "color 0.15s ease-out",
  _hover: { color: "fg", textDecoration: "none" },
  _focusVisible: {
    outline: "2px solid",
    outlineColor: "colorPalette.focusRing",
    outlineOffset: "-2px",
  },
  _after: {
    content: '""',
    position: "absolute",
    left: 3,
    right: 3,
    bottom: 0,
    height: "2px",
    borderRadius: "1px",
    background: "fg",
    opacity: 0,
  },
  "&[data-active]": { color: "fg", fontWeight: "medium" },
  "&[data-active]::after": { opacity: 1 },
} as const;

function PageTabLink({
  tab,
  isActive,
  onNavigate,
}: {
  tab: PageTab;
  isActive: boolean;
  onNavigate: (href: string) => void;
}) {
  return (
    <Link
      href={tab.href}
      variant="plain"
      aria-current={isActive ? "page" : void 0}
      data-active={isActive || void 0}
      data-testid={tab.testId}
      color="fg.muted"
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (isBrowserClick(event)) return;
        event.preventDefault();
        onNavigate(tab.href);
      }}
      css={TAB_STYLE}
    >
      {tab.label}
      <TabCount value={tab.count} />
    </Link>
  );
}

/** A header tab that opens a menu, a picker over an unbounded list; lit on one of its pages. */
export function PageTabMenu({
  label,
  isActive = false,
  testId,
  children,
}: {
  label: string;
  isActive?: boolean;
  testId?: string;
  /** The menu's items: Menu.Item, Menu.Separator. */
  children: ReactNode;
}) {
  return (
    <MenuRoot positioning={{ placement: "bottom-start" }}>
      <MenuTrigger asChild>
        <chakra.button
          type="button"
          color="fg.muted"
          data-active={isActive || void 0}
          data-testid={testId}
          css={TAB_STYLE}
        >
          <Box as="span" truncate maxWidth="240px">
            {label}
          </Box>
          <ChevronDown size={14} aria-hidden="true" />
        </chakra.button>
      </MenuTrigger>
      <MenuContent minWidth="220px">{children}</MenuContent>
    </MenuRoot>
  );
}

/** The tabs row; render it inside PageLayout.Header after the heading. */
export function PageTabs({
  label,
  tabs,
  activeHref,
  onNavigate,
  stackOnMobile = false,
  children,
}: {
  /** Names the navigation landmark ("Analytics pages"). */
  label: string;
  tabs: readonly PageTab[];
  /** The tab this page is; empty when none of `tabs` is, such as on a menu tab's page. */
  activeHref: string;
  onNavigate: (href: string) => void;
  /** Below `md`, drop to a full-width 36px row under the heading that scrolls sideways. */
  stackOnMobile?: boolean;
  /** Trailing tabs, such as a PageTabMenu. */
  children?: ReactNode;
}) {
  return (
    <Box
      as="nav"
      aria-label={label}
      data-page-tabs
      display="flex"
      alignItems="stretch"
      alignSelf="stretch"
      gap={1}
      marginStart={stackOnMobile ? { base: 0, md: 3 } : 3}
      // The tabs keep their width; the header's actions give way (they scroll) instead.
      flexShrink={0}
      {...(stackOnMobile
        ? {
            flexBasis: { base: "100%", md: "auto" },
            width: { base: "full", md: "auto" },
            minWidth: { base: 0, md: "auto" },
            height: { base: "36px", md: "auto" },
            overflowX: { base: "auto", md: "visible" },
          }
        : {})}
    >
      {tabs.map((tab) => (
        <PageTabLink
          key={tab.href}
          tab={tab}
          isActive={tab.href === activeHref}
          onNavigate={onNavigate}
        />
      ))}
      {children}
    </Box>
  );
}
