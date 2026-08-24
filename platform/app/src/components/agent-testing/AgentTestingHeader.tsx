/**
 * The one header line of the Agent Testing page: the page title on the left,
 * the tabs in the middle, and the action of the open tab on the right.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { Grid, GridItem, Tabs } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import type { AgentTestingTab } from "./useAgentTestingRouting";

export type AgentTestingHeaderProps = {
  tab: AgentTestingTab;
  onTabChange: (tab: AgentTestingTab) => void;
  /** The action of the Test cases tab. */
  onNewTestCase: () => void;
  /** The action of the Results tab. */
  onNewRunPlan: () => void;
};

export function AgentTestingHeader({
  tab,
  onTabChange,
  onNewTestCase,
  onNewRunPlan,
}: AgentTestingHeaderProps) {
  return (
    <PageLayout.Header>
      {/* The middle column takes the width of the tabs, so the tabs sit in the
          centre of the page and not in the centre of what is left of it. */}
      <Grid
        width="full"
        templateColumns="1fr auto 1fr"
        alignItems="center"
        gap={2}
      >
        <GridItem>
          <PageLayout.Heading>Agent Testing</PageLayout.Heading>
        </GridItem>

        <GridItem>
          <Tabs.Root
            value={tab}
            onValueChange={({ value }) => onTabChange(value as AgentTestingTab)}
            variant="line"
            size="sm"
            colorPalette="blue"
          >
            <Tabs.List borderBottomWidth={0}>
              <Tabs.Trigger value="cases">Test cases</Tabs.Trigger>
              <Tabs.Trigger value="results">Results</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </GridItem>

        <GridItem justifySelf="end">
          {tab === "cases" ? (
            <PageLayout.HeaderButton onClick={onNewTestCase}>
              <Plus size={16} /> New test case
            </PageLayout.HeaderButton>
          ) : (
            <PageLayout.HeaderButton onClick={onNewRunPlan}>
              <Plus size={16} /> New run plan
            </PageLayout.HeaderButton>
          )}
        </GridItem>
      </Grid>
    </PageLayout.Header>
  );
}
