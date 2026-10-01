/**
 * The rail and the header every analytics page sits in — chrome (sidebar,
 * top bar, drawer mount) belongs to the route tree, so this drops the
 * outermost wrapper. Which entry is selected ARRIVES AS A PROP, never read.
 */

import { Box } from "@langwatch/design-system/primitives";
import {
  SectionNavigationFrame,
  type SectionNavigationGroup,
  type SectionNavigationLink,
} from "@langwatch/design-system/section-navigation-frame";
import { Gauge, Hash, LayoutDashboard, ListChecks, Users } from "lucide-react";
import type { PropsWithChildren } from "react";

import { useFilterToggle } from "../../behavior/use-filter-toggle.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { AnalyticsHeader, type AnalyticsHeaderProps } from "./analytics-header.tsx";
import { CustomDashboardsSection } from "./custom-dashboards-section.tsx";
import { SavedViewsScope } from "./saved-views-scope.tsx";

/** Which rail entry the page being rendered is. */
export type AnalyticsRailEntry =
  | "overview"
  | "users"
  | "topics"
  | "metrics"
  | "evaluations"
  | "reports"
  | "custom";

export default function AnalyticsLayout({
  children,
  title,
  railEntry,
  analyticsHeaderProps,
  extraHeaderButtons,
}: PropsWithChildren<{
  title: string;
  railEntry?: AnalyticsRailEntry;
  analyticsHeaderProps?: Omit<AnalyticsHeaderProps, "title">;
  extraHeaderButtons?: React.ReactNode;
}>) {
  const host = useAnalyticsHost();
  const project = host.project();
  const { showFilters } = useFilterToggle();

  const base = `/${project?.slug}/analytics`;
  const link = (label: string, path: string, icon: SectionNavigationLink["icon"]) => ({
    label,
    href: `${base}${path}`,
    icon,
  });
  const entries = {
    overview: link("Overview", "", <LayoutDashboard size={14} />),
    users: link("Users", "/users", <Users size={14} />),
    topics: link("Topics", "/topics", <Hash size={14} />),
    metrics: link("LLM Metrics", "/metrics", <Gauge size={14} />),
    evaluations: link("Online Evaluations", "/evaluations", <ListChecks size={14} />),
  };
  const groups: SectionNavigationGroup[] = [
    { label: "Engagement", links: [entries.users, entries.topics] },
    { label: "Observability", links: [entries.metrics, entries.evaluations] },
    {
      label: "Custom",
      links: [],
      extra: project?.slug ? <CustomDashboardsSection projectSlug={project.slug} /> : null,
    },
  ];
  const activeHref =
    !railEntry || railEntry === "reports" || railEntry === "custom" ? "" : entries[railEntry].href;

  return (
    <SavedViewsScope>
      <AnalyticsHeader
        title={title}
        {...analyticsHeaderProps}
        extraHeaderButtons={extraHeaderButtons}
      />
      <Box width="full" padding={4} paddingBottom={16}>
        <SectionNavigationFrame
          label="Analytics"
          links={[entries.overview]}
          groups={groups}
          activeHref={activeHref}
          onNavigate={(href) => host.navigate(href)}
        >
          <Box maxWidth={showFilters ? "1612px" : "1200px"} marginX="auto">
            {children}
          </Box>
        </SectionNavigationFrame>
      </Box>
    </SavedViewsScope>
  );
}
