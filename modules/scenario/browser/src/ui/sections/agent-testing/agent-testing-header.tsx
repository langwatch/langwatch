/**
 * The one header line of the Agent Testing page, across its full width: the page title on the
 * left and the tabs in the middle. The content of either tab starts under it.
 * @see specs/features/agent-testing/page-structure.feature
 */
import { PageLayout, type PageTab } from "@langwatch/design-system/page-layout";
import { Box, Grid, GridItem, HStack, Text } from "@langwatch/design-system/primitives";

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
    <PageLayout.Header>
      {/* The outer columns share the free width, so the tabs sit in the middle of the page. */}
      <Grid
        width="full"
        alignSelf="stretch"
        templateColumns={{ base: "1fr", md: "1fr auto 1fr" }}
        alignItems="center"
        columnGap={4}
      >
        <GridItem minWidth={0}>
          <HStack gap={2} minWidth={0} alignItems="baseline">
            <Box minWidth={0} flex="0 1 auto">
              <PageLayout.Heading title={openPlan?.name} data-testid="agent-testing-title">
                {openPlan?.name ?? title}
              </PageLayout.Heading>
            </Box>
            {openPlan ? (
              <Text
                textStyle="caption"
                color="fg.muted"
                flexShrink={0}
                whiteSpace="nowrap"
                data-testid="agent-testing-title-note"
              >
                {openPlan.note}
              </Text>
            ) : null}
          </HStack>
        </GridItem>
        <GridItem alignSelf="stretch" display="flex">
          <PageLayout.Tabs
            stackOnMobile
            label="Agent testing pages"
            tabs={tabs}
            activeHref={tabHrefs[tab]}
            onNavigate={(href) => onTabChange(href === tabHrefs.results ? "results" : "cases")}
          />
        </GridItem>
        <GridItem display={{ base: "none", md: "block" }} />
      </Grid>
    </PageLayout.Header>
  );
}
