/**
 * The one header line of the Agent Testing page: the page title, then the tabs, left-aligned.
 * @see specs/features/agent-testing/page-structure.feature
 */
import { PageLayout, type PageTab } from "@langwatch/design-system/page-layout";
import { Box, Stack, Text } from "@langwatch/design-system/primitives";
import { SectionNavigationHeader } from "@langwatch/design-system/section-navigation-frame";

import type { AgentTestingTab } from "../../../behavior/agent-testing/use-agent-testing-routing.ts";
import type { OpenPlanTitle } from "../../../behavior/agent-testing/use-agent-testing-store.ts";

export type AgentTestingHeaderProps = {
  title?: string;
  tab: AgentTestingTab;
  onTabChange: (tab: AgentTestingTab) => void;
  /** Where each tab lives, so a tab is a real link. */
  tabHrefs: Record<AgentTestingTab, string>;
  /** How many scenarios the project holds, beside the Scenarios tab. */
  casesCount?: number;
  /** How many run plans the project holds, beside the Results tab. */
  plansCount?: number;
  /** The run plan the page is open on, when it is open on one. */
  openPlan?: OpenPlanTitle | null;
};

export function AgentTestingHeader({
  title = "Agent testing",
  tab,
  onTabChange,
  tabHrefs,
  casesCount,
  plansCount,
  openPlan,
}: AgentTestingHeaderProps) {
  const tabs: PageTab[] = [
    {
      label: "Scenarios",
      href: tabHrefs.cases,
      count: casesCount,
      testId: "agent-testing-tab-cases",
    },
    {
      label: "Results",
      href: tabHrefs.results,
      count: plansCount,
      testId: "agent-testing-tab-results",
    },
  ];

  return (
    <SectionNavigationHeader>
      {/* Below md the name sits over the note and wraps; the tabs drop to their own row. */}
      <Stack
        direction={{ base: "column", md: "row" }}
        alignItems={{ base: "stretch", md: "baseline" }}
        gap={{ base: 0.5, md: 2 }}
        width={{ base: "full", md: "auto" }}
        minWidth={0}
        maxWidth="full"
      >
        <Box minWidth={0} flex="0 1 auto">
          <PageLayout.Heading title={openPlan?.name} data-testid="agent-testing-title">
            {openPlan?.name ?? (tab === "results" ? "Results" : title)}
          </PageLayout.Heading>
        </Box>
        {openPlan ? (
          <Text textStyle="caption" color="fg.muted" data-testid="agent-testing-title-note">
            {openPlan.note}
          </Text>
        ) : null}
      </Stack>
      <PageLayout.Tabs
        stackOnMobile
        label="Agent testing pages"
        tabs={tabs}
        activeHref={tabHrefs[tab]}
        onNavigate={(href) => onTabChange(href === tabHrefs.results ? "results" : "cases")}
      />
    </SectionNavigationHeader>
  );
}
