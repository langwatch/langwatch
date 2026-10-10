/**
 * A section's navigation rail beside its content, the current link marked. It reads no route:
 * the page hands it `onNavigate`, so a plain click routes in place. Render it as the page's
 * root: it fills the card by flex, the rail stretches, and the content column scrolls.
 */
import { Box, chakra, HStack, Link, Stack, Text, useRecipe } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { isBrowserClick } from "./back-link.tsx";
import { PageLayout } from "./page-layout.tsx";
import { useSectionNavigationIndicator } from "./use-section-navigation-indicator.ts";

/** How wide the rail is, open and folded to its icons. */
export const SECTION_RAIL_WIDTH = 176;
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
        height="32px"
        paddingY={1.5}
        borderRadius="sm"
        color={active ? "fg" : "nav.fgMuted"}
        background="transparent"
        transition="color 0.15s ease-out"
        fontWeight={active ? "semibold" : void 0}
        _hover={{ color: "fg", textDecoration: "none" }}
      >
        <HStack gap={2} minWidth={0} flex={1}>
          {collapsed && link.icon ? (
            <Box as="span" display="flex" flexShrink={0} color="inherit">
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
      height="32px"
      paddingY={1.5}
      borderRadius="sm"
      textAlign="left"
      cursor="pointer"
      color="fg.muted"
      background="transparent"
      transition="color 0.15s ease-out"
      _hover={{ color: "fg" }}
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
  const railStyle = useRecipe({ key: "sectionNavigationRail" });
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
      css={railStyle()}
      minHeight={0}
      position="relative"
      paddingTop={0}
      paddingBottom={2}
    >
      <Text
        data-testid="section-navigation-title"
        display="flex"
        alignItems="center"
        height={SECTION_HEADER_HEIGHT}
        minHeight={SECTION_HEADER_HEIGHT}
        flexShrink={0}
        paddingX={5}
        fontSize="sm"
        lineHeight="20px"
        fontWeight="semibold"
        title={label}
        overflow="hidden"
        whiteSpace="nowrap"
      >
        {label}
      </Text>
      <Box flex={1} minHeight={0} overflow="auto">
        <Stack
          data-testid="section-navigation-list"
          position="relative"
          direction={{ base: "row", md: "column" }}
          alignItems="stretch"
          gap={{ base: 1, md: 4 }}
          paddingX={3}
          paddingTop={2}
          paddingBottom={2}
          minWidth="full"
          width={{ base: "max-content", md: "full" }}
        >
          <SectionNavigationIndicator />
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
                  fontSize="11px"
                  lineHeight="16px"
                  fontWeight="medium"
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
      </Box>
      {footer ? <Box flexShrink={0}>{footer}</Box> : null}
    </Box>
  );
}

function SectionNavigationIndicator() {
  const markerRef = useSectionNavigationIndicator();
  return (
    <Box
      ref={markerRef}
      data-testid="section-navigation-indicator"
      aria-hidden="true"
      position="absolute"
      top={0}
      left={0}
      width="3px"
      background="fg.subtle"
      borderStartEndRadius="2px"
      borderEndEndRadius="2px"
      pointerEvents="none"
      style={{ visibility: "hidden" }}
    />
  );
}

type SectionNavigationRailProps = {
  /** The section's name, at the top of the rail and in the rail's accessible name. */
  label: string;
  links?: readonly SectionNavigationLink[];
  /** Labelled runs under `links`, for a rail with more than one kind of entry. */
  groups?: readonly SectionNavigationGroup[];
  /** The entry this page is; the caller knows which page it rendered. */
  activeHref: string;
  /** Routes an entry in place; a click the browser keeps never reaches it. */
  onNavigate: (href: string) => void;
  /** Folds entries to icons; the section keeps its title row. */
  collapsed?: boolean;
  /** Pinned under the entries (a period picker, the fold toggle); the entries scroll above it. */
  footer?: ReactNode;
};

const SECTION_HEADER_HEIGHT = "shellHeader";

/** Both section title and sub-page header share this row geometry. */
export function SectionNavigationHeader({ children }: { children: ReactNode }) {
  return (
    <PageLayout.Header
      paddingY={0}
      height={SECTION_HEADER_HEIGHT}
      minHeight={SECTION_HEADER_HEIGHT}
      css={{
        // The hairline stops short of the rail's line by the gap that line leaves under
        // the header (56px less 48px), so the two meet at the corner with equal space.
        borderBottomColor: "transparent",
        _after: {
          content: '""',
          position: "absolute",
          left: "8px",
          right: 0,
          bottom: "-1px",
          height: "1px",
          background: "border.card",
          opacity: 0,
          transition: "opacity 160ms ease",
        },
        "&[data-scrolled=true]::after": { opacity: 1 },
        "& h1": {
          fontSize: "sm",
          lineHeight: "20px",
          fontWeight: "semibold",
          whiteSpace: "nowrap",
        },
        "& .chakra-button": {
          height: "28px",
          minHeight: "28px",
          paddingX: 2,
          gap: 1.5,
          fontSize: "xs",
          "& p": { fontSize: "inherit" },
          "& svg": { width: "14px", height: "14px" },
        },
      }}
    >
      {children}
    </PageLayout.Header>
  );
}

export function SectionNavigationFrame({
  header,
  pageTitle,
  headerActions,
  children,
  ...rail
}: SectionNavigationRailProps & {
  /** A custom SectionNavigationHeader, for editable titles or complex controls. */
  header?: ReactNode;
  /** Current sub-page, such as Overview or a selected dashboard name. */
  pageTitle?: string;
  headerActions?: ReactNode;
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
      <Box
        position="relative"
        flex={1}
        minWidth={0}
        minHeight={0}
        overflowY="auto"
        overflowX="hidden"
      >
        <Box position="sticky" top={0} zIndex={10} overflowX="auto" overscrollBehaviorX="contain">
          {header ?? (
            <SectionNavigationHeader>
              <PageLayout.Heading>{pageTitle ?? "Overview"}</PageLayout.Heading>
              {headerActions ? <Box marginLeft="auto">{headerActions}</Box> : null}
            </SectionNavigationHeader>
          )}
        </Box>
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
