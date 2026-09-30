/**
 * The automations screen frame and tab navigation (overview, automations,
 * alerts, schedules), on the design system's shared section rail.
 */

import { Box } from "@chakra-ui/react";
import {
  SectionNavigationFrame,
  type SectionNavigationLink,
} from "@langwatch/design-system/section-navigation-frame";
import type { LucideIcon } from "lucide-react";
import { Calendar, Eye, TrendingUp, Zap } from "lucide-react";
import type { ReactNode } from "react";

import { useAutomationHost } from "../../model/automation-host.ts";

export type AutomationSection = "overview" | "automations" | "alerts" | "schedules";

/** The four tabs, in the order the page has always listed them. */
export const AUTOMATION_SECTIONS: readonly {
  section: AutomationSection;
  label: string;
  /** Appended to the family's base path; empty for the overview. */
  suffix: string;
  icon: LucideIcon;
}[] = [
  { section: "overview", label: "Overview", suffix: "", icon: Eye },
  { section: "automations", label: "Automations", suffix: "/automations", icon: Zap },
  { section: "alerts", label: "Alerts", suffix: "/alerts", icon: TrendingUp },
  { section: "schedules", label: "Schedules", suffix: "/schedules", icon: Calendar },
];

export function AutomationsLayout({
  basePath,
  section = "overview",
  children,
}: {
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
    <Box width="full" padding={4} paddingBottom={16} data-testid="section-navigation-layout">
      <SectionNavigationFrame
        label="Automations"
        links={links}
        activeHref={`${basePath}${active?.suffix ?? ""}`}
        onNavigate={(href) => host.navigate(href)}
      >
        <Box data-testid="section-navigation-content">{children}</Box>
      </SectionNavigationFrame>
    </Box>
  );
}
