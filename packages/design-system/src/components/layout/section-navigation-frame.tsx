/**
 * A section's navigation rail beside its content, the current link marked. It reads no route:
 * the page hands it `onNavigate`, so a plain click routes in place. Render it as the page's
 * root: it fills the card by flex, the rail stretches, and the content column scrolls.
 */
import { Box, HStack, Link, Stack, Text } from "@chakra-ui/react";
import type { MouseEvent, ReactNode } from "react";

import { isBrowserClick } from "./back-link.tsx";

/** One entry on the rail: where it goes and how it reads. */
export type SectionNavigationLink = {
  label: string;
  href: string;
  icon?: ReactNode;
};

/** A labelled run of entries; `extra` renders under them (a list the page owns). */
export type SectionNavigationGroup = {
  label?: string;
  links: readonly SectionNavigationLink[];
  extra?: ReactNode;
};

const mix = (token: string, alpha: string) =>
  `color-mix(in srgb, var(--chakra-colors-${token}) ${alpha}, transparent)`;

/** Frosted glass: a sheen over a tinted ground; the card behind is opaque, so the rail tints it. */
const RAIL_GLASS = {
  background: {
    _light: `linear-gradient(180deg, ${mix("bg-panel", "75%")}, ${mix("bg-panel", "20%")}), radial-gradient(140% 45% at 0% 0%, ${mix("orange-100", "40%")}, transparent 70%), ${mix("bg-page", "var(--lw-panel-alpha, 80%)")}`,
    _dark: `linear-gradient(180deg, ${mix("fg", "5%")}, ${mix("fg", "1%")}), ${mix("bg-muted", "var(--lw-panel-alpha, 70%)")}`,
  },
  boxShadow: {
    _light: `inset -1px 0 0 ${mix("bg-panel", "80%")}, inset 0 1px 0 var(--chakra-colors-bg-panel)`,
    _dark: `inset -1px 0 0 ${mix("fg", "4%")}, inset 0 1px 0 ${mix("fg", "6%")}`,
  },
  border: { _light: "border.muted", _dark: "border" },
};
/** The current or hovered link: a brighter chip of the same glass. */
const LINK_CHIP = {
  background: { _light: mix("bg-panel", "85%"), _dark: mix("fg", "9%") },
  boxShadow: {
    _light: `0 0 0 1px ${mix("border", "70%")}, 0 1px 2px ${mix("fg", "6%")}, inset 0 1px 0 var(--chakra-colors-bg-panel)`,
    _dark: `0 0 0 1px ${mix("fg", "6%")}, inset 0 1px 0 ${mix("fg", "8%")}`,
  },
};

function RailLink({
  link,
  activeHref,
  onNavigate,
}: {
  link: SectionNavigationLink;
  activeHref: string;
  onNavigate: (href: string) => void;
}) {
  const active = link.href === activeHref;
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : void 0}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (isBrowserClick(event)) return;
        event.preventDefault();
        onNavigate(link.href);
      }}
      variant="plain"
      paddingX={2}
      paddingY={1}
      borderRadius="lg"
      flexShrink={0}
      {...(active ? LINK_CHIP : {})}
      fontWeight={active ? "medium" : void 0}
      _hover={{ ...LINK_CHIP, textDecoration: "none" }}
    >
      <HStack gap={2} minWidth={0}>
        {link.icon}
        <Text fontSize="sm" truncate title={link.label}>
          {link.label}
        </Text>
      </HStack>
    </Link>
  );
}

export function SectionNavigationFrame({
  label,
  hideTitle = false,
  header,
  links = [],
  groups = [],
  activeHref,
  onNavigate,
  children,
}: {
  /** The section's name, at the top of the rail and in the rail's accessible name. */
  label: string;
  /** Hides the title when the page header already says it; label stays the accessible name. */
  hideTitle?: boolean;
  /** The page's header (a PageLayout.Header); it spans the content column, never the rail. */
  header?: ReactNode;
  links?: readonly SectionNavigationLink[];
  /** Labelled runs under `links`, for a rail with more than one kind of entry. */
  groups?: readonly SectionNavigationGroup[];
  /** The entry this page is; the caller knows which page it rendered. */
  activeHref: string;
  /** Routes an entry in place; a click the browser keeps never reaches it. */
  onNavigate: (href: string) => void;
  children: ReactNode;
}) {
  const runs: readonly SectionNavigationGroup[] = [{ links }, ...groups].filter(
    (run) => run.links.length > 0 || run.extra !== void 0,
  );
  return (
    <Stack
      data-section-frame
      data-testid="section-navigation-layout"
      direction={{ base: "column", md: "row" }}
      alignItems="stretch"
      gap={0}
      width="full"
      flex="1"
      minHeight={0}
    >
      <Box
        as="nav"
        aria-label={`${label} navigation`}
        width={{ base: "full", md: "200px" }}
        minWidth={{ base: 0, md: "200px" }}
        flexShrink={0}
        overflowY={{ md: "auto" }}
        background={RAIL_GLASS.background}
        boxShadow={RAIL_GLASS.boxShadow}
        backdropFilter="var(--lw-backdrop-blur, blur(12px) saturate(1.35))"
        borderRightWidth={{ base: 0, md: "1px" }}
        borderRightColor={RAIL_GLASS.border}
        borderBottomWidth={{ base: "1px", md: 0 }}
        borderBottomColor={RAIL_GLASS.border}
        paddingX={2}
        paddingTop={{ base: 2, md: 0 }}
        paddingBottom={2}
      >
        {hideTitle ? (
          <Box display={{ base: "none", md: "block" }} height={3} />
        ) : (
          <Text
            data-testid="section-navigation-title"
            display={{ base: "none", md: "flex" }}
            alignItems="center"
            height="48px"
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
          gap={{ base: 1, md: 3 }}
          overflowX={{ base: "auto", md: "visible" }}
        >
          {runs.map((run, index) => (
            <Stack
              key={run.label ?? index}
              direction={{ base: "row", md: "column" }}
              alignItems="stretch"
              gap={1}
            >
              {run.label ? (
                <Text
                  display={{ base: "none", md: "block" }}
                  fontSize="xs"
                  color="fg.subtle"
                  paddingX={2}
                  paddingTop={1}
                >
                  {run.label}
                </Text>
              ) : null}
              {run.links.map((link) => (
                <RailLink
                  key={link.href}
                  link={link}
                  activeHref={activeHref}
                  onNavigate={onNavigate}
                />
              ))}
              {run.extra}
            </Stack>
          ))}
        </Stack>
      </Box>
      <Box flex={1} minWidth={0} minHeight={0} overflowY="auto">
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
