/** Frame for /ops/event-sourcing/* pages; title bar, section rail and content column. */

import { Badge, HStack } from "@chakra-ui/react";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  SectionNavigationFrame,
  type SectionNavigationLink,
} from "@langwatch/design-system/section-navigation-frame";
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
import type { PropsWithChildren } from "react";

import { api } from "../../behavior/ops-api.ts";
import { useOpsRouter } from "../../behavior/ops-router.ts";

const SECTION_LABEL = "Event Sourcing";

export function EventSourcingLayout({
  children,
  pageTitle,
}: PropsWithChildren<{ pageTitle?: string }>) {
  const items: SectionNavigationLink[] = [
    { label: "Overview", href: "/ops/event-sourcing", icon: <Activity size={14} /> },
    {
      label: "Dead Letters",
      href: "/ops/event-sourcing/dead-letters",
      icon: (
        <HStack gap={1}>
          <Skull size={14} />
          <DeadLetterBadge />
        </HStack>
      ),
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

  const router = useOpsRouter();
  const pathname = router.asPath.split(/[?#]/)[0] ?? "";
  const activeHref =
    items
      .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
      .toSorted((a, b) => b.href.length - a.href.length)[0]?.href ?? "";

  return (
    <>
      {pageTitle && (
        <PageLayout.Header>
          <PageLayout.Heading>{pageTitle}</PageLayout.Heading>
        </PageLayout.Header>
      )}
      <PageLayout.Container>
        <SectionNavigationFrame
          label={SECTION_LABEL}
          links={items}
          activeHref={activeHref}
          onNavigate={(href) => router.push(href)}
        >
          {children}
        </SectionNavigationFrame>
      </PageLayout.Container>
    </>
  );
}

/**
 * The dead total, in the navigation, on every page of this section. Absent
 * when zero - a permanent "0" beside a link trains the reader to stop
 * seeing it. Zero IS shown on the Dead Letters page itself (ops-dashboard.md).
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
