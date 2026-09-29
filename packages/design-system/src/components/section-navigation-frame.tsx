/**
 * A section's own navigation rail beside its content: the links it is handed, the
 * current one marked. Presentational only: it holds no data and reads no route, so
 * the page hands it `onNavigate` and a plain click routes in place, never reloading.
 */
import { Box, HStack, Link, Stack, Text } from "@chakra-ui/react";
import type { MouseEvent, ReactNode } from "react";

/** One entry on the rail: where it goes and how it reads. */
export type SectionNavigationLink = {
  label: string;
  href: string;
  icon?: ReactNode;
};

/** A click the browser keeps: a new tab, a new window, a download. */
function isBrowserClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function SectionNavigationFrame({
  label,
  links,
  activeHref,
  onNavigate,
  children,
}: {
  /** The section's name, over the rail and in the rail's accessible name. */
  label: string;
  links: readonly SectionNavigationLink[];
  /** The entry this page is; the caller knows which page it rendered. */
  activeHref: string;
  /** Routes an entry in place; a click the browser keeps never reaches it. */
  onNavigate: (href: string) => void;
  children: ReactNode;
}) {
  return (
    <Stack
      direction={{ base: "column", md: "row" }}
      alignItems={{ base: "stretch", md: "start" }}
      gap={{ base: 3, md: 6 }}
      width="full"
    >
      <Box
        as="nav"
        aria-label={`${label} navigation`}
        width={{ base: "full", md: "200px" }}
        minWidth={{ base: 0, md: "200px" }}
        flexShrink={0}
        borderRightWidth={{ base: 0, md: "1px" }}
        borderRightColor="border.muted"
        borderBottomWidth={{ base: "1px", md: 0 }}
        borderBottomColor="border.muted"
        paddingRight={{ base: 0, md: 4 }}
        paddingBottom={{ base: 2, md: 0 }}
      >
        <Text
          display={{ base: "none", md: "block" }}
          fontSize="xs"
          fontWeight="semibold"
          color="fg.muted"
          paddingX={3}
          paddingTop={1}
          paddingBottom={2}
          textTransform="uppercase"
          letterSpacing="wider"
        >
          {label}
        </Text>
        <Stack direction={{ base: "row", md: "column" }} alignItems="stretch" gap={1}>
          {links.map((link) => {
            const active = link.href === activeHref;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : void 0}
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  if (isBrowserClick(event)) return;
                  event.preventDefault();
                  onNavigate(link.href);
                }}
                variant="plain"
                paddingX={3}
                paddingY={1}
                borderRadius="lg"
                flexShrink={0}
                background={active ? "bg.muted" : void 0}
                fontWeight={active ? "medium" : void 0}
                _hover={{ background: "bg.muted", textDecoration: "none" }}
              >
                <HStack gap={2}>
                  {link.icon}
                  <Text>{link.label}</Text>
                </HStack>
              </Link>
            );
          })}
        </Stack>
      </Box>
      <Box flex={1} minWidth={0}>
        {children}
      </Box>
    </Stack>
  );
}
