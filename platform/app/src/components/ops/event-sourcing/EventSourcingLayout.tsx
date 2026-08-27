import { Badge } from "@chakra-ui/react";
import { Activity, CalendarClock, Layers, Radio, Skull, Workflow } from "lucide-react";
import type { PropsWithChildren } from "react";
import { OpsPageShell } from "~/components/ops/shared/OpsPageShell";
import { SectionNavigationLayout } from "~/components/ui/layouts/SectionNavigationLayout";
import { api } from "~/utils/api";

/**
 * The event-sourcing substrate as its own workspace.
 *
 * It used to be four independently dense sections stacked on one scroll —
 * projections, subscribers, processes, schedules — which meant an operator
 * mid-incident scrolled past three healthy sections to reach the one that was
 * wrong. ops-dashboard.md's rule is that space is proportional to trouble, and
 * a single page cannot honour that for four subsystems at once.
 *
 * Each section is now a route, so the reader chooses the subsystem and the
 * page spends its whole viewport on it. The main sidebar is unchanged: it
 * already matches `/ops/event-sourcing` by prefix, so this is a sub-nav inside
 * one entry rather than five new top-level links — the same shape
 * `/ai-gateway` uses.
 */
export function EventSourcingLayout({
  children,
  pageTitle,
}: PropsWithChildren<{ pageTitle?: string }>) {
  return (
    <OpsPageShell>
      <SectionNavigationLayout
        sectionLabel="Event Sourcing"
        pageTitle={pageTitle}
        navigationItems={[
          {
            label: "Overview",
            href: "/ops/event-sourcing",
            icon: <Activity size={14} />,
          },
          {
            label: "Dead Letters",
            href: "/ops/event-sourcing/dead-letters",
            includePath: "/ops/event-sourcing/dead-letters",
            icon: <Skull size={14} />,
            menuEnd: <DeadLetterBadge />,
          },
          {
            label: "Processes",
            href: "/ops/event-sourcing/processes",
            includePath: "/ops/event-sourcing/processes",
            icon: <Workflow size={14} />,
          },
          {
            label: "Projections",
            href: "/ops/event-sourcing/projections",
            includePath: "/ops/event-sourcing/projections",
            icon: <Layers size={14} />,
          },
          {
            label: "Subscribers",
            href: "/ops/event-sourcing/subscribers",
            includePath: "/ops/event-sourcing/subscribers",
            icon: <Radio size={14} />,
          },
          {
            label: "Schedules",
            href: "/ops/event-sourcing/schedules",
            includePath: "/ops/event-sourcing/schedules",
            icon: <CalendarClock size={14} />,
          },
          // Both were top-level Ops entries, and neither is a subsystem the
          // operator watches for trouble — they are tools you reach for once
          // you know where the trouble is. They read the same substrate as
          // every section above, so the rail is where they belong; the Ops
          // menu is for workspaces, not for each tool inside one.
          {
            label: "Payload store",
            href: "/ops/blobs",
            includePath: "/ops/blobs",
            icon: <Database size={14} />,
          },
          {
            label: "Deja View",
            href: "/ops/dejaview",
            includePath: "/ops/dejaview",
            icon: <History size={14} />,
          },
        ]}
      >
        {children}
      </SectionNavigationLayout>
    </OpsPageShell>
  );
}

/**
 * The dead total, in the navigation, on every page of this section.
 *
 * Absent when the count is zero: a nav item is not a counter panel, and a
 * permanent "0" beside a link trains the reader to stop seeing it. The zero
 * IS shown on the Dead Letters page itself, where ops-dashboard.md's rule
 * applies — there, a zero is how the operator knows the panel is live.
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
