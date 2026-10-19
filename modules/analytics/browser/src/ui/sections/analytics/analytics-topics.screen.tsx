import { Card } from "@langwatch/design-system/card";
import { Box, GridItem, SimpleGrid, HStack } from "@langwatch/design-system/primitives";
import { BarChart2 } from "react-feather";

import AnalyticsLayout from "../../../ui/sections/analytics-layout.tsx";
import { CustomGraph, type CustomGraphInput } from "../../../ui/sections/custom-graph.tsx";
import { FilterSidebar } from "../../../ui/sections/filter-sidebar.tsx";
import { TopicsSelector } from "../../../ui/sections/topics-selector.tsx";
import { withAggregateAnalyticsGate } from "../aggregate-analytics-gate.tsx";

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
    <AnalyticsLayout tab="topics">
      <HStack alignItems="start" width="full" gap={6}>
        <SimpleGrid templateColumns="repeat(4, 1fr)" gap={5} width="100%">
          <GridItem colSpan={1} display="inline-grid">
            <Card padding="lg" title="Top Topics">
              <Box maxHeight="340px" overflowY="auto">
                <TopicsSelector showTitle={false} />
              </Box>
            </Card>
          </GridItem>
          <GridItem colSpan={3} display="inline-grid">
            <Card
              padding="lg"
              icon={<BarChart2 color="var(--chakra-colors-orange-fg)" />}
              title="Threads Per Topic"
            >
              <CustomGraph input={threadsPerTopic as CustomGraphInput} />
            </Card>
          </GridItem>
          <GridItem colSpan={2} display="inline-grid">
            <Card
              padding="lg"
              icon={<BarChart2 color="var(--chakra-colors-orange-fg)" />}
              title="Most Discussed Topics"
            >
              <CustomGraph input={mostDiscussedTopics as CustomGraphInput} />
            </Card>
          </GridItem>
        </SimpleGrid>
        <FilterSidebar hideTopics={true} />
      </HStack>
    </AnalyticsLayout>
  );
}

/**
 * The page guard is the routes section's, not this module's:
 * `analytics-routes.tsx` wraps these in `withPermissionGuard("analytics:view")`
 * (and `DashboardLayout` on two), in the composing app's own route tree.
 */
export default withAggregateAnalyticsGate("Topics", TopicsContent);
