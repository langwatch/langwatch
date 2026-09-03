/**
 * The frame every `/ops/event-sourcing/*` page renders inside.
 *
 * `platform/app`'s `EventSourcingLayout` wrapped `OpsPageShell` (an access gate
 * plus an error boundary) around `SectionNavigationLayout`, which wrapped
 * `DashboardLayout` — the whole application chrome. Two of those three layers
 * are not this family's: the access gate is the page guard's job now and the
 * chrome belongs to the route tree, and these pages are children of a layout
 * route the composing application still serves.
 *
 * So what moved is the middle layer only — the section rail and the content
 * column, harvested from `SectionNavigationFrame` — over the family's own copy
 * of the navigation rows. The gateway family took the same decision for the
 * same reason (`gateway-web`'s `ui/sections/gateway-layout.tsx`), and the rows
 * below are the ones `platform/app` listed, in the same order, including the
 * two tools that are sections of this workspace rather than Ops entries of
 * their own.
 *
 * KNOWN GAP, and the reason this file says so out loud: the outer
 * `DashboardLayout` does not come with it. An `/ops` page served from `apps/ui`
 * renders this frame and its content, and the application header, sidebar and
 * org-scope chip are not above it until a chrome layout route exists in the
 * route table. That route is the next structural slice, not this one.
 */

import { Badge, Box, Container, HStack, Spacer, Stack, Text } from "@chakra-ui/react";
import {
  Activity,
  CalendarClock,
  Database,
  History,
  Layers,
  Radio,
  Skull,
  Workflow,
} from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import { api } from "../../behavior/ops-api";
import { Link } from "../elements/ops-link";

const SECTION_LABEL = "Event Sourcing";

type EventSourcingNavItem = {
  label: string;
  href: string;
  icon: ReactNode;
  menuEnd?: ReactNode;
};

export function EventSourcingLayout({
  children,
  pageTitle: _pageTitle,
}: PropsWithChildren<{ pageTitle?: string }>) {
  const items: EventSourcingNavItem[] = [
    { label: "Overview", href: "/ops/event-sourcing", icon: <Activity size={14} /> },
    {
      label: "Dead Letters",
      href: "/ops/event-sourcing/dead-letters",
      icon: <Skull size={14} />,
      menuEnd: <DeadLetterBadge />,
    },
    { label: "Processes", href: "/ops/event-sourcing/processes", icon: <Workflow size={14} /> },
    { label: "Projections", href: "/ops/event-sourcing/projections", icon: <Layers size={14} /> },
    { label: "Subscribers", href: "/ops/event-sourcing/subscribers", icon: <Radio size={14} /> },
    {
      label: "Schedules",
      href: "/ops/event-sourcing/schedules",
      icon: <CalendarClock size={14} />,
    },
    // Both were top-level Ops entries, and neither is a subsystem the operator
    // watches for trouble — they are tools you reach for once you know where
    // the trouble is. They read the same substrate as every section above, so
    // the rail is where they belong; the Ops menu is for workspaces, not for
    // each tool inside one.
    { label: "Payload store", href: "/ops/blobs", icon: <Database size={14} /> },
    { label: "Deja View", href: "/ops/dejaview", icon: <History size={14} /> },
  ];

  return (
    <Box width="full" padding={4} data-testid="section-navigation-layout">
      <Container maxW="1600px" paddingX={0} data-testid="section-navigation-container">
        <Stack
          direction={{ base: "column", md: "row" }}
          alignItems={{ base: "stretch", md: "start" }}
          gap={{ base: 3, md: 6 }}
          width="full"
        >
          <Box
            as="nav"
            aria-label={`${SECTION_LABEL} navigation`}
            width={{ base: "full", md: "220px" }}
            minWidth={{ base: 0, md: "220px" }}
            flexShrink={0}
            borderRightWidth={{ base: 0, md: "1px" }}
            borderRightColor="border.muted"
            borderBottomWidth={{ base: "1px", md: 0 }}
            borderBottomColor="border.muted"
            paddingRight={{ base: 0, md: 4 }}
            paddingBottom={{ base: 2, md: 0 }}
          >
            <Text
              data-testid="section-navigation-title"
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
              {SECTION_LABEL}
            </Text>
            <Stack
              data-testid="section-navigation-links"
              direction={{ base: "row", md: "column" }}
              alignItems="stretch"
              gap={1}
              overflowX={{ base: "auto", md: "visible" }}
              paddingBottom={{ base: 1, md: 0 }}
            >
              {items.map((item) => (
                // Each link keeps its intrinsic width in the horizontal strip,
                // so the strip scrolls rather than squeezing the labels.
                <Box key={`${item.href}:${item.label}`} flexShrink={0}>
                  <Link
                    href={item.href}
                    variant="plain"
                    paddingX={4}
                    paddingY={1}
                    width="full"
                    borderRadius="lg"
                    _hover={{ background: "bg.muted" }}
                  >
                    <HStack width="full" gap={2}>
                      {item.icon}
                      <Text>{item.label}</Text>
                      <Spacer />
                      {item.menuEnd}
                    </HStack>
                  </Link>
                </Box>
              ))}
            </Stack>
          </Box>

          <Box flex={1} minWidth={0} data-testid="section-navigation-content">
            {children}
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}

/**
 * The dead total, in the navigation, on every page of this section.
 *
 * Absent when the count is zero: a nav item is not a counter panel, and a
 * permanent "0" beside a link trains the reader to stop seeing it. The zero IS
 * shown on the Dead Letters page itself, where ops-dashboard.md's rule applies
 * — there, a zero is how the operator knows the panel is live.
 */
function DeadLetterBadge() {
  const counts = api.ops.listDeadLetterCounts.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const total = (counts.data ?? []).reduce((sum, row) => sum + row.count, 0);
  if (total === 0) return null;
  return (
    <Badge size="xs" colorPalette="red" variant="solid">
      {total}
    </Badge>
  );
}
