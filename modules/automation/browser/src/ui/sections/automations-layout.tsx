/**
 * The automations screen frame: the shared section rail runs full height on the
 * left, the page header and content sit right of it (one header, not two). The
 * retired alerts path renders the automations tab, so that tab is highlighted.
 */

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Box } from "@langwatch/design-system/primitives";
import {
  SectionNavigationFrame,
  type SectionNavigationLink,
} from "@langwatch/design-system/section-navigation-frame";
import type { LucideIcon } from "lucide-react";
import { Calendar, Eye, Zap } from "lucide-react";
import type { ReactNode } from "react";

import { useAutomationHost } from "../../model/automation-host.ts";

export type AutomationSection = "overview" | "automations" | "reports";

/** The three tabs; reports keep the "/schedules" path they shipped under. */
export const AUTOMATION_SECTIONS: readonly {
  section: AutomationSection;
  label: string;
  /** Appended to the family's base path; empty for the overview. */
  suffix: string;
  icon: LucideIcon;
}[] = [
  { section: "overview", label: "Overview", suffix: "", icon: Eye },
  { section: "automations", label: "Automations", suffix: "/automations", icon: Zap },
  { section: "reports", label: "Reports", suffix: "/schedules", icon: Calendar },
];

export function AutomationsLayout({
  title,
  basePath,
  section = "overview",
  children,
}: {
  /** The page heading, rendered in the content column beside the rail. */
  title: string;
  basePath: string;
  /** The tab this page is. */
  section?: AutomationSection;
  children: ReactNode;
}) {
  const host = useAutomationHost();
  const links: SectionNavigationLink[] = AUTOMATION_SECTIONS.map((item) => ({
    label: item.label,
    href: `${basePath}${item.suffix}`,
    icon: <item.icon size={14} />,
  }));
  const active = AUTOMATION_SECTIONS.find((item) => item.section === section);

  return (
    <Box width="full" paddingX={4} paddingBottom={16} data-testid="section-navigation-layout">
      <SectionNavigationFrame
        label="Automations"
        links={links}
        activeHref={`${basePath}${active?.suffix ?? ""}`}
        onNavigate={(href) => host.navigate(href)}
      >
        <PageLayout.Header height="auto" paddingX={0} paddingBottom={3} marginBottom={4}>
          <PageLayout.Heading>{title}</PageLayout.Heading>
        </PageLayout.Header>
        <Box data-testid="section-navigation-content">{children}</Box>
      </SectionNavigationFrame>
    </Box>
  );
}
