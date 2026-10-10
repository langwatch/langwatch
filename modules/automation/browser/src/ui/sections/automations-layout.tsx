/**
 * The automations screen frame: the shared section rail runs full height on the
 * left, the page header and content sit right of it (one header, not two). The
 * retired alerts path renders the automations tab, so that tab is highlighted.
 */

import { PageLayout } from "@langwatch/design-system/page-layout";
import { Spacer } from "@langwatch/design-system/primitives";
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
  actions,
  children,
}: {
  /** The page heading, rendered in the content column beside the rail. */
  title: string;
  basePath: string;
  /** The tab this page is. */
  section?: AutomationSection;
  /** The page's own buttons, at the header's end. */
  actions?: ReactNode;
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
    <SectionNavigationFrame
      label="Automations"
      header={
        <PageLayout.Header>
          <PageLayout.Heading>{title}</PageLayout.Heading>
          {actions ? (
            <>
              <Spacer />
              {actions}
            </>
          ) : null}
        </PageLayout.Header>
      }
      links={links}
      activeHref={`${basePath}${active?.suffix ?? ""}`}
      onNavigate={(href) => host.navigate(href)}
    >
      {children}
    </SectionNavigationFrame>
  );
}
