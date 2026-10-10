/**
 * A section's navigation rail beside its content, the current link marked. It reads no route:
 * the page hands it `onNavigate`, so a plain click routes in place. Render it as the page's
 * root: it fills the card by flex, the rail stretches, and the content column scrolls.
 */
import { Box, chakra, HStack, Link, Stack, Text, useRecipe } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { isBrowserClick } from "./back-link.tsx";

/** How wide the rail is, open and folded to its icons. */
export const SECTION_RAIL_WIDTH = 200;
export const SECTION_RAIL_COLLAPSED_WIDTH = 56;

/** One entry on the rail: where it goes and how it reads. */
export type SectionNavigationLink = {
  label: string;
  href: string;
  icon?: ReactNode;
  /** Trailing text inside the entry, a count; it gives way to `actions` under the pointer. */
  badge?: ReactNode;
  /** The entry's own controls (a row menu), beside the link, shown on hover, focus or open. */
  actions?: ReactNode;
  testId?: string;
};

/** The row that adds one more entry to a run; it wears the entry's shape, under the entries. */
export type SectionNavigationAdd = {
  label: string;
  onClick: () => void;
  testId?: string;
};

/** A labelled run of entries; `add` ends it, `extra` renders under them (a list the page owns). */
export type SectionNavigationGroup = {
  label?: string;
  links: readonly SectionNavigationLink[];
  extra?: ReactNode;
  add?: SectionNavigationAdd;
};

const mix = (token: string, alpha: string) =>
  `color-mix(in srgb, var(--chakra-colors-${token}) ${alpha}, transparent)`;

/** An opaque brand tint keeps the current link distinct from the textured rail. */
const LINK_ACTIVE = { background: "nav.bgSelected", color: "fg" };
const LINK_HOVER = { background: mix("nav-bg-active", "55%"), color: "fg" };

/** One rail entry; exported for a list a page owns in a group's `extra`, so it reads the same. */
export function SectionNavigationItem({
  link,
  activeHref,
  collapsed = false,
  onNavigate,
}: {
  link: SectionNavigationLink;
  activeHref: string;
  collapsed?: boolean;
  onNavigate: (href: string) => void;
}) {
  const active = link.href === activeHref;
  const actions = collapsed ? void 0 : link.actions;
  return (
    <Box className="group" position="relative" flexShrink={0}>
      <Link
        href={link.href}
        aria-current={active ? "page" : void 0}
        aria-label={collapsed ? link.label : void 0}
        title={collapsed ? link.label : void 0}
        data-testid={link.testId}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (isBrowserClick(event)) return;
          event.preventDefault();
          onNavigate(link.href);
        }}
        variant="plain"
        display="flex"
        width="full"
        paddingX={2}
        paddingY={1.5}
        borderRadius="lg"
        color="nav.fg"
        transition="background-color 0.15s ease-in-out, color 0.15s ease-in-out"
        {...(active ? LINK_ACTIVE : {})}
        fontWeight={active ? "semibold" : void 0}
        _hover={{ ...(active ? LINK_ACTIVE : LINK_HOVER), textDecoration: "none" }}
      >
        <HStack gap={2} minWidth={0} flex={1}>
          {link.icon ? (
            <Box
              as="span"
              display="flex"
              flexShrink={0}
              color={active ? "accent.fg" : "nav.fgMuted"}
            >
              {link.icon}
            </Box>
          ) : null}
          {collapsed ? null : (
            <Text fontSize="sm" truncate title={link.label} flex={1}>
              {link.label}
            </Text>
          )}
          {collapsed || link.badge === void 0 ? null : (
            <Text
              as="span"
              fontSize="xs"
              color="fg.muted"
              _groupHover={actions ? { opacity: 0 } : void 0}
            >
              {link.badge}
            </Text>
          )}
        </HStack>
      </Link>
      {actions ? (
        // Beside the link, never inside it: a control inside an anchor takes its keypress.
        <Box
          position="absolute"
          right={1}
          top="50%"
          transform="translateY(-50%)"
          display="flex"
          opacity={0}
          _groupHover={{ opacity: 1 }}
          _focusWithin={{ opacity: 1 }}
          css={{ "&:has([data-state=open])": { opacity: 1 } }}
        >
          {actions}
        </Box>
      ) : null}
    </Box>
  );
}

/** The add row, exported for a list a page owns in a group's `extra`. */
export function SectionNavigationAddRow({ add }: { add: SectionNavigationAdd }) {
  return (
    <chakra.button
      type="button"
      onClick={add.onClick}
      data-testid={add.testId}
      display="flex"
      alignItems="center"
      gap={2}
      flexShrink={0}
      paddingX={2}
      paddingY={1.5}
      borderRadius="lg"
      textAlign="left"
      cursor="pointer"
      color="fg.muted"
      transition="background-color 0.15s ease-in-out, color 0.15s ease-in-out"
      _hover={LINK_HOVER}
    >
      <Plus size={14} />
      <Text fontSize="sm" truncate>
        {add.label}
      </Text>
    </chakra.button>
  );
}

/**
 * The rail alone, for a page whose content column scrolls and pads itself; most pages
 * want SectionNavigationFrame, which sets this beside a content column.
 */
export function SectionNavigationRail({
  label,
  hideTitle = false,
  links = [],
  groups = [],
  activeHref,
  onNavigate,
  collapsed = false,
  footer,
}: SectionNavigationRailProps) {
  const runs: readonly SectionNavigationGroup[] = [{ links }, ...groups].filter(
    (run) => run.links.length > 0 || (!collapsed && (run.extra !== void 0 || run.add !== void 0)),
  );
  const glass = useRecipe({ key: "sectionNavigationRail" });
  const width = collapsed ? SECTION_RAIL_COLLAPSED_WIDTH : SECTION_RAIL_WIDTH;
  return (
    <Box
      as="nav"
      aria-label={`${label} navigation`}
      data-collapsed={collapsed || void 0}
      display="flex"
      flexDirection="column"
      width={{ base: "full", md: `${width}px` }}
      minWidth={{ base: 0, md: `${width}px` }}
      flexShrink={0}
      css={glass()}
      minHeight={0}
      borderRightWidth={{ base: 0, md: "1px" }}
      borderBottomWidth={{ base: "1px", md: 0 }}
      paddingX={2}
      paddingTop={{ base: 2, md: 0 }}
      paddingBottom={2}
    >
      {hideTitle || collapsed ? (
        <Box display={{ base: "none", md: "block" }} height={3} flexShrink={0} />
      ) : (
        <Text
          data-testid="section-navigation-title"
          display={{ base: "none", md: "flex" }}
          alignItems="center"
          height="48px"
          flexShrink={0}
          paddingX={2}
          fontSize="md"
          fontWeight="semibold"
        >
          {label}
        </Text>
      )}
      <Stack
        direction={{ base: "row", md: "column" }}
        alignItems="stretch"
        gap={{ base: 1, md: 4 }}
        flex={1}
        minHeight={0}
        overflowX={{ base: "auto", md: "visible" }}
        overflowY={{ md: "auto" }}
      >
        {runs.map((run, index) => (
          <Stack
            key={run.label ?? index}
            direction={{ base: "row", md: "column" }}
            alignItems="stretch"
            gap={0.5}
          >
            {run.label && !collapsed ? (
              <Text
                display={{ base: "none", md: "block" }}
                fontSize="2xs"
                fontWeight="semibold"
                letterSpacing="0.06em"
                textTransform="uppercase"
                color="nav.fgMuted"
                paddingX={2}
                paddingBottom={1}
              >
                {run.label}
              </Text>
            ) : null}
            {run.links.map((link) => (
              <SectionNavigationItem
                key={link.href}
                link={link}
                activeHref={activeHref}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
            {collapsed ? null : run.extra}
            {collapsed || !run.add ? null : <SectionNavigationAddRow add={run.add} />}
          </Stack>
        ))}
      </Stack>
      {footer ? <Box flexShrink={0}>{footer}</Box> : null}
    </Box>
  );
}

type SectionNavigationRailProps = {
  /** The section's name, at the top of the rail and in the rail's accessible name. */
  label: string;
  /** Hides the title when the page header already says it; label stays the accessible name. */
  hideTitle?: boolean;
  links?: readonly SectionNavigationLink[];
  /** Labelled runs under `links`, for a rail with more than one kind of entry. */
  groups?: readonly SectionNavigationGroup[];
  /** The entry this page is; the caller knows which page it rendered. */
  activeHref: string;
  /** Routes an entry in place; a click the browser keeps never reaches it. */
  onNavigate: (href: string) => void;
  /** Folds the rail to its icons: titles, labels, extras and actions step aside. */
  collapsed?: boolean;
  /** Pinned under the entries (a period picker, the fold toggle); the entries scroll above it. */
  footer?: ReactNode;
};

export function SectionNavigationFrame({
  header,
  children,
  ...rail
}: SectionNavigationRailProps & {
  /** The page's header (a PageLayout.Header); it spans the content column, never the rail. */
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack
      data-section-frame
      background="bg.surface"
      overflow="hidden"
      data-testid="section-navigation-layout"
      direction={{ base: "column", md: "row" }}
      alignItems="stretch"
      gap={0}
      width="full"
      flex="1"
      minWidth={0}
      minHeight={0}
    >
      <SectionNavigationRail {...rail} />
      <Box position="relative" flex={1} minWidth={0} minHeight={0} overflowY="auto">
        {header}
        <Box
          data-testid="section-navigation-content"
          paddingX={6}
          paddingTop={4}
          paddingBottom={16}
        >
          {children}
        </Box>
      </Box>
    </Stack>
  );
}
