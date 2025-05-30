import { Card, GridItem, HStack, Heading, SimpleGrid } from "@chakra-ui/react";
import { BarChart2 } from "react-feather";
import GraphsLayout from "~/components/GraphsLayout";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import { SatisfactionGraphs } from "~/components/analytics/SatisfactionGraph";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { AnalyticsHeader } from "../../../components/analytics/AnalyticsHeader";
import { FeedbacksTable } from "../../../components/analytics/FeedbacksTable";
import { QuickwitNote } from "../../../components/analytics/QuickwitNote";
import { usePublicEnv } from "../../../hooks/usePublicEnv";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY;

const messagesCount = {
  graphId: "custom",
  graphType: "summary",
  series: [
    {
      name: "Messages count",
      colorSet: "orangeTones",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
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
    {
      name: "Users count",
      colorSet: "blueTones",
      metric: "metadata.user_id",
      aggregation: "cardinality",
    },
  ],
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

const userCountGrapgh = {
  graphId: "custom",
  graphType: "area",
  series: [
    {
      name: "Users count",
      colorSet: "blueTones",
      metric: "metadata.user_id",
      aggregation: "cardinality",
    },
  ],
  includePrevious: true,
  timeScale: ONE_DAY,
  height: 300,
};

const dailyActiveThreads = {
  graphId: "custom",
  graphType: "area",
  series: [
    {
      name: "Threads count",
      colorSet: "greenTones",
      metric: "metadata.thread_id",
      aggregation: "cardinality",
    },
  ],
  includePrevious: true,
  timeScale: ONE_DAY,
  height: 300,
};

const averageDailyThreadsPerUser = {
  graphId: "custom",
  graphType: "bar",
  series: [
    {
      name: "Average threads count per user",
      colorSet: "greenTones",
      metric: "metadata.thread_id",
      aggregation: "cardinality",
      pipeline: {
        field: "user_id",
        aggregation: "avg",
      },
    },
  ],
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

const messageSentiment = {
  graphId: "custom",
  graphType: "stacked_bar",
  series: [
    {
      name: "Average messages count per user",
      colorSet: "positiveNegativeNeutral",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      pipeline: {
        field: "user_id",
        aggregation: "avg",
      },
    },
  ],
  groupBy: "sentiment.input_sentiment",
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

const powerUsers = {
  graphId: "custom",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Messages count",
      colorSet: "colors",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    },
  ],
  groupBy: "metadata.user_id",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

const maxMessagePerThread = {
  graphId: "custom",
  graphType: "scatter",
  series: [
    {
      name: "Maximum messages count per thread",
      colorSet: "blueTones",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      pipeline: {
        field: "thread_id",
        aggregation: "max",
      },
    },
  ],
  includePrevious: true,
  timeScale: ONE_DAY,
  connected: false,
  height: 300,
};

const userThreads = {
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
  ],
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

export default function Users() {
  const publicEnv = usePublicEnv();
  const isNotQuickwit = publicEnv.data && !publicEnv.data.IS_QUICKWIT;
  const isQuickwit = publicEnv.data && publicEnv.data.IS_QUICKWIT;

  return (
    <GraphsLayout>
      <AnalyticsHeader title="Users" />
      <HStack alignItems="start" width="full" gap={6}>
        <SimpleGrid templateColumns="repeat(4, 1fr)" gap={5} width="100%">
          <GridItem colSpan={2} display="inline-grid">
            <Card.Root overflow="auto">
              <Card.Header>
                <Heading size="sm">User Messages</Heading>
              </Card.Header>
              <Card.Body>
                <CustomGraph input={messagesCount as CustomGraphInput} />
              </Card.Body>
            </Card.Root>
          </GridItem>
          <GridItem colSpan={2} display="inline-grid">
            <Card.Root overflow="auto">
              <Card.Header>
                <Heading size="sm">User Threads</Heading>
              </Card.Header>
              <Card.Body>
                <CustomGraph input={userThreads as CustomGraphInput} />
              </Card.Body>
            </Card.Root>
          </GridItem>

          <GridItem colSpan={2} display="inline-grid">
            <Card.Root>
              <Card.Header>
                <HStack gap={2}>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Daily Users</Heading>
                </HStack>
              </Card.Header>
              <Card.Body>
                <CustomGraph input={userCountGrapgh as CustomGraphInput} />
              </Card.Body>
            </Card.Root>
          </GridItem>
          <GridItem colSpan={2} display="inline-grid">
            <Card.Root>
              <Card.Header>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Daily Threads</Heading>
                </HStack>
              </Card.Header>
              <Card.Body>
                <CustomGraph input={dailyActiveThreads as CustomGraphInput} />
              </Card.Body>
            </Card.Root>
          </GridItem>

          <GridItem colSpan={2} display="inline-grid">
            <Card.Root>
              <Card.Header>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">User Satisfaction</Heading>
                </HStack>
              </Card.Header>
              <Card.Body>
                <CustomGraph input={messageSentiment as CustomGraphInput} />
              </Card.Body>
            </Card.Root>
          </GridItem>

          <GridItem colSpan={2} display="inline-grid">
            <Card.Root>
              <Card.Header>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Max Messages Per Thread</Heading>
                </HStack>
              </Card.Header>
              <Card.Body>
                <CustomGraph input={maxMessagePerThread as CustomGraphInput} />
              </Card.Body>
            </Card.Root>
          </GridItem>
          <GridItem colSpan={2} display="inline-grid">
            <Card.Root>
              <Card.Header>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">User Leaderboard</Heading>
                </HStack>
              </Card.Header>
              <Card.Body>
                <CustomGraph input={powerUsers as CustomGraphInput} />
              </Card.Body>
            </Card.Root>
          </GridItem>
          <GridItem colSpan={2} display="inline-grid">
            <SatisfactionGraphs />
          </GridItem>
          <GridItem colSpan={4} display="inline-grid">
            <Card.Root>
              <Card.Header>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">User Feedbacks</Heading>
                </HStack>
              </Card.Header>
              <Card.Body>
                {isNotQuickwit ? (
                  <FeedbacksTable />
                ) : isQuickwit ? (
                  <QuickwitNote />
                ) : null}
              </Card.Body>
            </Card.Root>
          </GridItem>
        </SimpleGrid>
        <FilterSidebar hideTopics={true} />
      </HStack>
    </GraphsLayout>
  );
}
