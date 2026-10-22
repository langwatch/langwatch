import { Card } from "@langwatch/design-system/card";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, GridItem, HStack, SimpleGrid } from "@langwatch/design-system/primitives";
import { Users } from "lucide-react";

import { ChartCard } from "../../../ui/elements/chart-card.tsx";
import AnalyticsLayout from "../../../ui/sections/analytics-layout.tsx";
import { CustomGraph, type CustomGraphInput } from "../../../ui/sections/custom-graph.tsx";
import { FeedbacksTable } from "../../../ui/sections/feedbacks-table.tsx";
import { FilterSidebar } from "../../../ui/sections/filter-sidebar.tsx";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY;

const messagesCount: CustomGraphInput = {
  graphId: "userTracesSummary",
  graphType: "summary",
  series: [
    {
      name: "Traces count",
      colorSet: "orangeTones",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    },
    {
      name: "Average traces per user",
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

const userCountGraph: CustomGraphInput = {
  graphId: "dailyUsers",
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

const dailyActiveThreads: CustomGraphInput = {
  graphId: "dailyThreads",
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

const powerUsers: CustomGraphInput = {
  graphId: "userLeaderboard",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Traces count",
      colorSet: "colors",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    },
  ],
  groupBy: "metadata.user_id",
  excludeUnknownBuckets: true,
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

const maxMessagePerThread: CustomGraphInput = {
  graphId: "maxTracesPerThread",
  graphType: "scatter",
  series: [
    {
      name: "Maximum traces count per thread",
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

const userThreads: CustomGraphInput = {
  graphId: "userThreadsSummary",
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

const tracesByLabel: CustomGraphInput = {
  graphId: "tracesByLabel",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Traces count",
      colorSet: "colors",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    },
  ],
  groupBy: "metadata.labels",
  excludeUnknownBuckets: true,
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

const tracesByCustomer: CustomGraphInput = {
  graphId: "tracesByCustomer",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Traces count",
      colorSet: "colors",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    },
  ],
  groupBy: "metadata.customer_id",
  excludeUnknownBuckets: true,
  includePrevious: false,
  timeScale: "full",
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

function UsersContent() {
  return (
    <AnalyticsLayout tab="users">
      <HStack alignItems="start" width="full" gap={6}>
        <SimpleGrid templateColumns="repeat(4, 1fr)" gap={5} width="100%">
          <GridItem colSpan={2} display="inline-grid">
            <Card padding="lg" title="User traces">
              <Box overflow="auto">
                <CustomGraph input={messagesCount} emptyState={userEmptyState} />
              </Box>
            </Card>
          </GridItem>
          <GridItem colSpan={2} display="inline-grid">
            <Card padding="lg" title="User threads">
              <Box overflow="auto">
                <CustomGraph input={userThreads} emptyState={userEmptyState} />
              </Box>
            </Card>
          </GridItem>
          <ChartCard title="Daily users" colSpan={2}>
            <CustomGraph input={userCountGraph} emptyState={userEmptyState} />
          </ChartCard>
          <ChartCard title="Daily Threads" colSpan={2}>
            <CustomGraph input={dailyActiveThreads} />
          </ChartCard>
          <ChartCard title="Max Traces Per Thread" colSpan={2}>
            <CustomGraph input={maxMessagePerThread} />
          </ChartCard>
          <ChartCard title="User Leaderboard" colSpan={2}>
            <CustomGraph input={powerUsers} emptyState={userEmptyState} />
          </ChartCard>
          <ChartCard title="Traces by Label" colSpan={2}>
            <CustomGraph input={tracesByLabel} />
          </ChartCard>
          <ChartCard title="Traces by Customer" colSpan={2}>
            <CustomGraph input={tracesByCustomer} emptyState={userEmptyState} />
          </ChartCard>
          <ChartCard title="User Feedbacks" colSpan={4}>
            <FeedbacksTable />
          </ChartCard>
        </SimpleGrid>
        <FilterSidebar hideTopics={true} />
      </HStack>
    </AnalyticsLayout>
  );
}

/**
 * The page guard is the routes section's, not this module's. `platform/app` wrapped these in
 * `withPermissionGuard("analytics:view")` and `DashboardLayout` — both the composing
 * application's job, stated once in `analytics-routes.tsx`, in front of the same loader registry.
 */
export default UsersContent;
