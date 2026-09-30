/**
 * The automations screen frame and tab navigation (overview, automations,
 * reports), on the design system's shared section rail. The retired alerts
 * path renders the automations tab, so that tab is the one highlighted.
 */

import { Box, Container } from "@chakra-ui/react";
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
    <Box width="full" padding={4} data-testid="section-navigation-layout">
      <Container maxW="1600px" paddingX={0} data-testid="section-navigation-container">
        <SectionNavigationFrame
          label="Automations"
          links={links}
          activeHref={`${basePath}${active?.suffix ?? ""}`}
          onNavigate={(href) => host.navigate(href)}
        >
          <Box data-testid="section-navigation-content">{children}</Box>
        </SectionNavigationFrame>
      </Container>
    </Box>
  );
}
