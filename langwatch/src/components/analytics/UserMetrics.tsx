import { CustomGraph, type CustomGraphInput } from "./CustomGraph";
import { analyticsMetrics } from "../../server/analytics/registry";
import {
  GridItem,
  Card,
  Tabs,
  VStack,
  Grid,
  Heading,
} from "@chakra-ui/react";

import { SatisfactionGraphs } from "./SatisfactionGraph";
import { SessionsSummary } from "./SessionsSummary";
import { TopicsSelector } from "../filters/TopicsSelector";
import { usePublicEnv } from "../../hooks/usePublicEnv";

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
            <Tabs.Root variant="plain">
              <Tabs.List gap={8}>
                <Tabs.Trigger value="messages" paddingX={0} paddingBottom={4}>
                  <CustomGraph
                    input={{ ...messagesGraph, graphType: "summary" }}
                    titleProps={{
                      fontSize: 16,
                      color: "black",
                    }}
                  />
                </Tabs.Trigger>
                <Tabs.Trigger value="threads" paddingX={0} paddingBottom={4}>
                  <CustomGraph
                    input={{ ...threadsGraph, graphType: "summary" }}
                    titleProps={{
                      fontSize: 16,
                      color: "black",
                    }}
                  />
                </Tabs.Trigger>
                <Tabs.Trigger value="users" paddingX={0} paddingBottom={4}>
                  <CustomGraph
                    input={{ ...usersGraph, graphType: "summary" }}
                    titleProps={{
                      fontSize: 16,
                      color: "black",
                    }}
                  />
                </Tabs.Trigger>
                <Tabs.Indicator
                  mt="-1.5px"
                  height="4px"
                  bg="orange.400"
                  borderRadius="1px"
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
          <Card.Root width="100%" minHeight={isNotQuickwit ? "328px" : "528px"}>
            <Card.Header>
              <Heading size="sm">Top Topics</Heading>
            </Card.Header>
            <Card.Body maxHeight="260px" overflowY="scroll">
              <TopicsSelector showTitle={false} />
            </Card.Body>
          </Card.Root>
          {isNotQuickwit && <SatisfactionGraphs />}
        </VStack>
      </GridItem>
      {isNotQuickwit && (
        <GridItem>
          <SessionsSummary />
        </GridItem>
      )}
    </Grid>
  );
}
