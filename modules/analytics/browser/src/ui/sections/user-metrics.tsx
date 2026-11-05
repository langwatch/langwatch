import { Card } from "@langwatch/design-system/card";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, Grid, GridItem, Tabs } from "@langwatch/design-system/primitives";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { Users } from "lucide-react";

import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { analyticsMetrics } from "../../model/analytics-registry.ts";
import { CustomGraph, type CustomGraphInput } from "./custom-graph.tsx";
import { TopicsSelector } from "./topics-selector.tsx";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY;

// Thread-focused: metrics without user grouping
const threadMetrics: CustomGraphInput = {
  graphId: "threadMetrics",
  graphType: "summary",
  series: [
    {
      name: "Threads count",
      colorSet: "greenTones",
      metric: "metadata.thread_id",
      aggregation: "cardinality",
    },
    {
      name: "Avg messages per thread",
      colorSet: "orangeTones",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      pipeline: { field: "thread_id", aggregation: "avg" },
    },
    {
      name: "Avg thread duration",
      colorSet: "purpleTones",
      metric: "threads.average_duration_per_thread",
      aggregation: "avg",
    },
  ],
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

const userEmptyState = (
  <NoDataInfoBlock
    size="inline"
    bordered={false}
    icon={<Users size={20} />}
    title="No user data yet"
    description="Start tracking users to see metrics here."
    docsHref="https://langwatch.ai/docs/integration/metadata-and-labels"
  />
);

export function UserMetrics() {
  // Topics are clustered inside one project, so an aggregate offers none (ADR-177 v4.15).
  const offersTopics = !isAggregateProjectKind(useAnalyticsHost().project()?.kind);
  const messagesGraph: CustomGraphInput = {
    graphId: "messagesCountGraph",
    graphType: "line",
    series: [
      {
        name: "Traces",
        metric: "metadata.trace_id",
        aggregation: "cardinality",
        colorSet: analyticsMetrics.metadata.trace_id.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: true,
    timeScale: ONE_DAY,
  };

  const threadsGraph: CustomGraphInput = {
    graphId: "threadsCountGraph",
    graphType: "line",
    series: [
      {
        name: "Threads",
        metric: "metadata.thread_id",
        aggregation: "cardinality",
        colorSet: analyticsMetrics.metadata.thread_id.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: true,
    timeScale: ONE_DAY,
  };

  const usersGraph: CustomGraphInput = {
    graphId: "usersCountGraph",
    graphType: "line",
    series: [
      {
        name: "Users",
        metric: "metadata.user_id",
        aggregation: "cardinality",
        colorSet: analyticsMetrics.metadata.user_id.colorSet,
        noDataUrl: "https://langwatch.ai/docs/integration/metadata-and-labels",
      },
    ],
    groupBy: undefined,
    includePrevious: true,
    timeScale: ONE_DAY,
  };

  return (
    <Grid
      width="full"
      templateColumns={[
        "minmax(350px, 1fr)",
        "minmax(350px, 1fr)",
        "minmax(350px, 1fr)",
        "minmax(350px, 2fr) minmax(250px, 1fr)",
      ]}
      gap={6}
    >
      <GridItem>
        <Card padding="none">
          <Box paddingX={5} paddingBottom={5} paddingTop={2}>
            <Tabs.Root
              variant="line"
              defaultValue="messages"
              // Every panel here is a read-only CustomGraph analytics
              // query with no user-entered state, so fully unmounting
              // inactive tabs is safe and avoids holding queries for
              // graphs the user never looks at.
              lazyMount
              unmountOnExit
            >
              <Tabs.List gap={8}>
                <Tabs.Trigger value="messages" paddingX={0} paddingBottom={0} height="fit-content">
                  <CustomGraph
                    input={{ ...messagesGraph, graphType: "summary" }}
                    titleProps={{
                      textStyle: "sm",
                      color: "fg",
                    }}
                  />
                </Tabs.Trigger>
                <Tabs.Trigger value="threads" paddingX={0} paddingBottom={0} height="fit-content">
                  <CustomGraph
                    input={{ ...threadsGraph, graphType: "summary" }}
                    titleProps={{
                      textStyle: "sm",
                      color: "fg",
                    }}
                  />
                </Tabs.Trigger>
                <Tabs.Trigger value="users" paddingX={0} paddingBottom={0} height="fit-content">
                  <CustomGraph
                    input={{ ...usersGraph, graphType: "summary" }}
                    titleProps={{
                      textStyle: "sm",
                      color: "fg",
                    }}
                  />
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="messages">
                <CustomGraph input={messagesGraph} />
              </Tabs.Content>
              <Tabs.Content value="threads">
                <CustomGraph input={threadsGraph} />
              </Tabs.Content>
              <Tabs.Content value="users">
                <CustomGraph input={usersGraph} emptyState={userEmptyState} />
              </Tabs.Content>
            </Tabs.Root>
          </Box>
        </Card>
      </GridItem>
      {offersTopics && (
        <GridItem rowSpan={2}>
          <Card variant="panel-fill" padding="lg" title="Top topics">
            <Box overflowY="auto" flex={1} minHeight={0}>
              <TopicsSelector showTitle={false} />
            </Box>
          </Card>
        </GridItem>
      )}
      <GridItem>
        <Card padding="lg" title="Thread metrics">
          <CustomGraph input={threadMetrics} />
        </Card>
      </GridItem>
    </Grid>
  );
}
