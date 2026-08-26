/**
 * The one header line of the Agent Testing page: the page title on the left
 * and the tabs in the middle.
 *
 * With a run plan open the title is the name of that plan, with what the plan
 * is beside it. Leaving the plan hands the title back to the page.
 *
 * Neither tab carries an action here. Every write entry sits in the section
 * header above the table it writes into: New test case beside the set it files
 * into, New run plan beside the Test Runs list it adds to.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { Box, Grid, GridItem, HStack, Tabs, Text } from "@chakra-ui/react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { FG_MUTED } from "./shared/design";
import type { AgentTestingTab } from "./useAgentTestingRouting";
import type { OpenPlanTitle } from "./useAgentTestingStore";

export type AgentTestingHeaderProps = {
  tab: AgentTestingTab;
  onTabChange: (tab: AgentTestingTab) => void;
  /** How many test cases the project holds, beside the Test cases tab. */
  casesCount?: number;
  /** How many run plans the project holds, beside the Results tab. */
  plansCount?: number;
  /** The run plan the page is open on, when it is open on one. */
  openPlan?: OpenPlanTitle | null;
};

/** The small count that sits beside a tab name. */
function TabCount({ value }: { value?: number }) {
  if (typeof value !== "number") return null;

  return (
    <Box
      as="span"
      borderRadius="full"
      background="bg.muted"
      paddingX={1.5}
      fontSize="10.5px"
      color={FG_MUTED}
    >
      {value}
    </Box>
  );
}

export function AgentTestingHeader({
  tab,
  onTabChange,
  casesCount,
  plansCount,
  openPlan,
}: AgentTestingHeaderProps) {
  return (
    <PageLayout.Header>
      {/* The middle column takes the width of the tabs, so the tabs sit in the
          centre of the page and not in the centre of what is left of it. The
          right column stays empty and balances the title on the left. Every
          page title in the product is the same size, so the header carries no
          padding or alignment override of its own: the defaults set by
          PageLayout.Header rule. */}
      <Grid
        width="full"
        templateColumns="1fr auto 1fr"
        alignItems="center"
        gap={4}
      >
        <GridItem minWidth={0}>
          <HStack gap={2} minWidth={0} alignItems="baseline">
            <PageLayout.Heading>
              {openPlan?.name ?? "Agent Testing"}
            </PageLayout.Heading>
            {openPlan ? (
              <Text
                fontSize="11.5px"
                color={FG_MUTED}
                truncate
                data-testid="agent-testing-title-note"
              >
                {openPlan.note}
              </Text>
            ) : null}
          </HStack>
        </GridItem>

        <GridItem>
          <Tabs.Root
            value={tab}
            onValueChange={({ value }) => onTabChange(value as AgentTestingTab)}
            variant="line"
            size="sm"
          >
            <Tabs.List borderBottomWidth={0} gap={1}>
              <AgentTestingTabTrigger
                value="cases"
                label="Test cases"
                count={casesCount}
              />
              <AgentTestingTabTrigger
                value="results"
                label="Results"
                count={plansCount}
              />
            </Tabs.List>
          </Tabs.Root>
        </GridItem>

        <GridItem />
      </Grid>
    </PageLayout.Header>
  );
}

function AgentTestingTabTrigger({
  value,
  label,
  count,
}: {
  value: AgentTestingTab;
  label: string;
  count?: number;
}) {
  return (
    <Tabs.Trigger
      value={value}
      paddingX={3}
      gap={1.5}
      fontSize="13px"
      fontWeight="normal"
      color="fg.muted"
      css={{ "--indicator-color": "colors.fg" }}
      _selected={{ color: "fg", fontWeight: "medium" }}
    >
      {label}
      <TabCount value={count} />
    </Tabs.Trigger>
  );
}
