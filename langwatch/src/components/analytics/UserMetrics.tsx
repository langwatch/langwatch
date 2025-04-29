import { CustomGraph, type CustomGraphInput } from "./CustomGraph";
import { analyticsMetrics } from "../../server/analytics/registry";
import { GridItem, Card, Tabs, VStack, Grid, Heading } from "@chakra-ui/react";

import { SatisfactionGraphs } from "./SatisfactionGraph";
import { TopicsSelector } from "../filters/TopicsSelector";
import { usePublicEnv } from "../../hooks/usePublicEnv";

export const userThreads = {
  graphId: "custom",
  graphType: "summary",
  series: [
    {
      name: "Threads count",
      colorSet: "greenTones",
      metric: "metadata.thread_id",
      aggregation: "cardinality",
    },

    {
      name: "Average threads per user",
      colorSet: "greenTones",
      metric: "metadata.thread_id",
      aggregation: "cardinality",
      pipeline: {
        field: "user_id",
        aggregation: "avg",
      },
    },
    {
      name: "Average thread duration",
      colorSet: "purpleTones",
      metric: "threads.average_duration_per_thread",
      aggregation: "avg",
      pipeline: {
        field: "user_id",
        aggregation: "avg",
      },
    },
    {
      name: "Average messages per user",
      colorSet: "orangeTones",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      pipeline: {
        field: "user_id",
        aggregation: "avg",
      },
    },
  ],
  includePrevious: false,
  timeScale: "1",
  height: 300,
};

export function UserMetrics() {
  const publicEnv = usePublicEnv();
  const isNotQuickwit = publicEnv.data && !publicEnv.data.IS_QUICKWIT;

  const messagesGraph: CustomGraphInput = {
    graphId: "messagesCountGraph",
    graphType: "line",
    series: [
      {
        name: "Messages",
        metric: "metadata.trace_id",
        aggregation: "cardinality",
        colorSet: analyticsMetrics.metadata.trace_id.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: true,
    timeScale: 1,
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
    timeScale: 1,
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
      },
    ],
    groupBy: undefined,
    includePrevious: true,
    timeScale: 1,
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
        <Card.Root>
          <Card.Body>
            <Tabs.Root variant="plain" defaultValue="messages">
              <Tabs.List gap={8}>
                <Tabs.Trigger
                  value="messages"
                  paddingX={0}
                  paddingBottom={0}
                  height="fit-content"
                >
                  <CustomGraph
                    input={{ ...messagesGraph, graphType: "summary" }}
                    titleProps={{
                      fontSize: 14,
                      color: "black",
                      paddingBottom: 2,
                    }}
                  />
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="threads"
                  paddingX={0}
                  paddingBottom={0}
                  height="fit-content"
                >
                  <CustomGraph
                    input={{ ...threadsGraph, graphType: "summary" }}
                    titleProps={{
                      fontSize: 14,
                      color: "black",
                      paddingBottom: 2,
                    }}
                  />
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="users"
                  paddingX={0}
                  paddingBottom={0}
                  height="fit-content"
                >
                  <CustomGraph
                    input={{ ...usersGraph, graphType: "summary" }}
                    titleProps={{
                      fontSize: 14,
                      color: "black",
                      paddingBottom: 2,
                    }}
                  />
                </Tabs.Trigger>
                <Tabs.Indicator
                  mt="-1.5px"
                  height="4px"
                  bg="orange.400"
                  borderRadius="1px"
                  bottom={0}
                />
              </Tabs.List>
              <Tabs.Content value="messages">
                <CustomGraph input={messagesGraph} />
              </Tabs.Content>
              <Tabs.Content value="threads">
                <CustomGraph input={threadsGraph} />
              </Tabs.Content>
              <Tabs.Content value="users">
                <CustomGraph input={usersGraph} />
              </Tabs.Content>
            </Tabs.Root>
          </Card.Body>
        </Card.Root>
      </GridItem>
      <GridItem rowSpan={2}>
        <VStack gap={6}>
          <Card.Root width="100%" minHeight={isNotQuickwit ? "300px" : "528px"}>
            <Card.Header paddingBottom={4}>
              <Heading size="sm">Top Topics</Heading>
            </Card.Header>
            <Card.Body maxHeight="240px" overflowY="scroll">
              <TopicsSelector showTitle={false} />
            </Card.Body>
          </Card.Root>
          {isNotQuickwit && <SatisfactionGraphs />}
        </VStack>
      </GridItem>
      {isNotQuickwit && (
        <GridItem>
          <Card.Root overflow="scroll">
            <Card.Header>
              <Heading size="sm">User Threads</Heading>
            </Card.Header>
            <Card.Body>
              <CustomGraph input={userThreads as CustomGraphInput} />
            </Card.Body>
          </Card.Root>
        </GridItem>
      )}
    </Grid>
  );
}
