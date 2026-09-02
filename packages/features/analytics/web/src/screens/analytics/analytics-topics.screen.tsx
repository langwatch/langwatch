import { Card, GridItem, Heading, HStack, SimpleGrid } from "@chakra-ui/react";
import { BarChart2 } from "react-feather";
import { CustomGraph, type CustomGraphInput } from "../../ui/sections/custom-graph";
import { FilterSidebar } from "../../ui/sections/filter-sidebar";
import AnalyticsLayout from "../../ui/sections/analytics-layout";
import { TopicsSelector } from "../../ui/sections/topics-selector";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY;

const threadsPerTopic = {
  graphId: "threadsPerTopic",
  graphType: "stacked_bar",
  series: [
    {
      name: "Threads count",
      colorSet: "colors",
      metric: "metadata.thread_id",
      aggregation: "cardinality",
    },
  ],
  groupBy: "topics.topics",
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

const mostDiscussedTopics = {
  graphId: "mostDiscussedTopics",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Traces count",
      colorSet: "colors",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    },
  ],
  groupBy: "topics.topics",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

function TopicsContent() {
  return (
    <AnalyticsLayout title="Topics" railEntry="topics">
      <HStack alignItems="start" width="full" gap={6}>
        <SimpleGrid templateColumns="repeat(4, 1fr)" gap={5} width="100%">
          <GridItem colSpan={1} display="inline-grid">
            <Card.Root height="100%">
              <Card.Header>
                <Heading size="sm">Top Topics</Heading>
              </Card.Header>
              <Card.Body maxHeight="340px" overflowY="auto">
                <TopicsSelector showTitle={false} />
              </Card.Body>
            </Card.Root>
          </GridItem>
          <GridItem colSpan={3} display="inline-grid">
            <Card.Root>
              <Card.Header>
                <HStack gap={2}>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Threads Per Topic</Heading>
                </HStack>
              </Card.Header>
              <Card.Body>
                <CustomGraph input={threadsPerTopic as CustomGraphInput} />
              </Card.Body>
            </Card.Root>
          </GridItem>
          <GridItem colSpan={2} display="inline-grid">
            <Card.Root>
              <Card.Header>
                <HStack gap={2}>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Most Discussed Topics</Heading>
                </HStack>
              </Card.Header>
              <Card.Body>
                <CustomGraph input={mostDiscussedTopics as CustomGraphInput} />
              </Card.Body>
            </Card.Root>
          </GridItem>
        </SimpleGrid>
        <FilterSidebar hideTopics={true} />
      </HStack>
    </AnalyticsLayout>
  );
}

/**
 * The page guard is the routes section's, not this module's.
 *
 * `platform/app` wrapped each of these in `withPermissionGuard("analytics:view")`
 * — and, on two of them, in `DashboardLayout` as well. Both are the composing
 * application's: the policy is stated once in
 * `apps/ui/src/features/analytics/ui/sections/analytics-routes.tsx`, in front of
 * the same loader registry, and the chrome belongs to the route tree these
 * screens are children of.
 */
export default TopicsContent;
