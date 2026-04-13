import { Card, Grid, GridItem, Heading, Tabs } from "@chakra-ui/react";
import { useFilterParams } from "../../hooks/useFilterParams";
import { analyticsMetrics } from "../../server/analytics/registry";
import { api } from "../../utils/api";
import { TopicsSelector } from "../filters/TopicsSelector";
import { CustomGraph, type CustomGraphInput } from "./CustomGraph";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY;

// User-focused: metrics grouped by user
const userFocusedThreads: CustomGraphInput = {
  graphId: "userThreads",
  graphType: "summary",
  series: [
    {
      name: "Threads count",
      colorSet: "greenTones",
      metric: "metadata.thread_id",
      aggregation: "cardinality",
    },
    {
      name: "Avg threads per user",
      colorSet: "greenTones",
      metric: "metadata.thread_id",
      aggregation: "cardinality",
      pipeline: { field: "user_id", aggregation: "avg" },
    },
    {
      name: "Avg thread duration",
      colorSet: "purpleTones",
      metric: "threads.average_duration_per_thread",
      aggregation: "avg",
      pipeline: { field: "user_id", aggregation: "avg" },
    },
    {
      name: "Avg messages per user",
      colorSet: "orangeTones",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      pipeline: { field: "user_id", aggregation: "avg" },
    },
  ],
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

// Thread-focused: metrics without user grouping
const threadFocusedMetrics: CustomGraphInput = {
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

// Exported for users.tsx page which always uses user-focused
export const userThreads = userFocusedThreads;

export function UserMetrics() {
  const { filterParams, queryOpts } = useFilterParams();

  // Detect if users are being tracked to pick the right thread metrics variant
  const usersQuery = api.analytics.getTimeseries.useQuery(
    {
      ...filterParams,
      series: [
        {
          metric: "metadata.user_id",
          aggregation: "cardinality",
        },
      ],
      timeScale: "full",
      groupBy: undefined,
    },
    { ...queryOpts, keepPreviousData: true },
  );

  const hasUsers = usersQuery.data?.currentPeriod?.some((entry) =>
    Object.values(entry).some(
      (v) => typeof v === "number" && v > 0,
    ),
  );

  const activeThreadMetrics = hasUsers
    ? userFocusedThreads
    : threadFocusedMetrics;

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
        <Card.Root border="1px solid" borderColor="border.emphasized">
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
                      textStyle: "sm",
                      color: "fg",
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
                      textStyle: "sm",
                      color: "fg",
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
                      textStyle: "sm",
                      color: "fg",
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
        <Card.Root width="100%" height="100%">
          <Card.Header paddingBottom={4}>
            <Heading size="sm">Top Topics</Heading>
          </Card.Header>
          <Card.Body overflowY="auto">
            <TopicsSelector showTitle={false} />
          </Card.Body>
        </Card.Root>
      </GridItem>
      <GridItem>
        <Card.Root overflow="auto">
          <Card.Header>
            <Heading size="sm">
              {hasUsers ? "User Threads" : "Thread Metrics"}
            </Heading>
          </Card.Header>
          <Card.Body>
            <CustomGraph input={activeThreadMetrics} />
          </Card.Body>
        </Card.Root>
      </GridItem>
    </Grid>
  );
}
