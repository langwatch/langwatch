import { Box, HStack, SimpleGrid } from "@chakra-ui/react";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import { ChartCard } from "~/components/analytics/ChartCard";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import GraphsLayout from "~/components/GraphsLayout";
import { withPermissionGuard } from "../../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY; // 1440

const LLMMetrics: CustomGraphInput = {
  graphId: "llmMetricsSummary",
  graphType: "summary",
  series: [
    {
      name: "LLM Calls",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      colorSet: "colors",
    },
    {
      name: "Total cost",
      colorSet: "greenTones",
      metric: "performance.total_cost",
      aggregation: "sum",
    },
    {
      name: "Total tokens",
      colorSet: "purpleTones",
      metric: "performance.total_tokens",
      aggregation: "sum",
    },
  ],
  includePrevious: true,
  timeScale: ONE_DAY,
  height: 300,
};

const LLMSummary: CustomGraphInput = {
  graphId: "llmPerformanceSummary",
  graphType: "summary",
  series: [
    {
      name: "Average tokens per message",
      colorSet: "colors",
      metric: "performance.total_tokens",
      aggregation: "avg",
    },
    {
      name: "Average cost per message",
      colorSet: "greenTones",
      metric: "performance.total_cost",
      aggregation: "avg",
    },
    {
      name: "90th Percentile time to first token",
      colorSet: "cyanTones",
      metric: "performance.first_token",
      aggregation: "p90",
    },
    {
      name: "90th Percentile completion time",
      colorSet: "greenTones",
      metric: "performance.completion_time",
      aggregation: "p90",
    },
  ],
  includePrevious: true,
  timeScale: ONE_DAY,
  height: 300,
};

const llmCallsByModel: CustomGraphInput = {
  graphId: "llmCallsByModel",
  graphType: "area",
  series: [
    {
      name: "LLM Calls",
      colorSet: "colors",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    },
  ],
  groupBy: "metadata.model",
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

const llmSplitByModel: CustomGraphInput = {
  graphId: "llmSplitByModel",
  graphType: "donnut",
  series: [
    {
      name: "LLM Calls",
      colorSet: "colors",
      metric: "metadata.span_type",
      aggregation: "cardinality",
      key: "llm",
    },
  ],
  groupBy: "metadata.model",
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

const completionTime: CustomGraphInput = {
  graphId: "avgCompletionTimeByModel",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Completion time average",
      colorSet: "colors",
      metric: "performance.completion_time",
      aggregation: "avg",
    },
  ],
  groupBy: "metadata.model",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

const totalCostPerModel: CustomGraphInput = {
  graphId: "avgCostPerModel",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Average cost per message",
      colorSet: "colors",
      metric: "performance.total_cost",
      aggregation: "avg",
      pipeline: {
        field: "trace_id",
        aggregation: "avg",
      },
    },
  ],
  groupBy: "metadata.model",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

const averageTokensPerMessage: CustomGraphInput = {
  graphId: "avgTokensPerModel",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Average completion tokens per message",
      colorSet: "colors",
      metric: "performance.completion_tokens",
      aggregation: "avg",
      pipeline: {
        field: "trace_id",
        aggregation: "avg",
      },
    },
  ],
  groupBy: "metadata.model",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

const latencyTrend: CustomGraphInput = {
  graphId: "latencyTrend",
  graphType: "line",
  series: [
    {
      name: "P90 Completion Time",
      colorSet: "greenTones",
      metric: "performance.completion_time",
      aggregation: "p90",
    },
    {
      name: "P90 Time to First Token",
      colorSet: "cyanTones",
      metric: "performance.first_token",
      aggregation: "p90",
    },
  ],
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

const tokensPerSecondByModel: CustomGraphInput = {
  graphId: "tokensPerSecondByModel",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Average tokens per second",
      colorSet: "cyanTones",
      metric: "performance.tokens_per_second",
      aggregation: "avg",
    },
  ],
  groupBy: "metadata.model",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

const errorRateByModel: CustomGraphInput = {
  graphId: "errorRateByModel",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Traces with errors",
      colorSet: "orangeTones",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
    },
  ],
  groupBy: "error.has_error",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

function MetricsContent() {
  const { hasPermission } = useOrganizationTeamProject();
  const canViewCost = hasPermission("cost:view");

  // Filter out cost metrics if user doesn't have cost:view permission
  const LLMMetricsFiltered = {
    ...LLMMetrics,
    series: LLMMetrics.series.filter(
      (s) => canViewCost || !s.metric?.includes("total_cost"),
    ),
  };

  const LLMSummaryFiltered = {
    ...LLMSummary,
    series: LLMSummary.series.filter(
      (s) => canViewCost || !s.metric?.includes("total_cost"),
    ),
  };

  return (
    <GraphsLayout title="LLM Metrics">
      <HStack alignItems="start" gap={4}>
        <SimpleGrid templateColumns="repeat(4, 1fr)" gap={5} width={"100%"}>
          <ChartCard title="LLM Metrics" colSpan={2}>
            <CustomGraph input={LLMMetricsFiltered} />
          </ChartCard>
          <ChartCard title="Summary" colSpan={2}>
            <CustomGraph input={LLMSummaryFiltered} />
          </ChartCard>
          <ChartCard title="LLM Usage" colSpan={4}>
            <CustomGraph input={llmCallsByModel} />
          </ChartCard>
          <ChartCard title="LLM Split" colSpan={2}>
            <CustomGraph input={llmSplitByModel} />
          </ChartCard>
          <ChartCard title="Average Completion Time" colSpan={2}>
            <CustomGraph input={completionTime} />
          </ChartCard>
          {canViewCost && (
            <ChartCard title="Average Cost Per Message" colSpan={2}>
              <CustomGraph input={totalCostPerModel} />
            </ChartCard>
          )}
          <ChartCard title="Average Tokens Per Message" colSpan={2}>
            <CustomGraph input={averageTokensPerMessage} />
          </ChartCard>
          <ChartCard title="Latency Trend" colSpan={4}>
            <CustomGraph input={latencyTrend} />
          </ChartCard>
          <ChartCard title="Tokens Per Second" colSpan={2}>
            <CustomGraph input={tokensPerSecondByModel} />
          </ChartCard>
          <ChartCard title="Error Distribution" colSpan={2}>
            <CustomGraph input={errorRateByModel} />
          </ChartCard>
        </SimpleGrid>
        <Box padding={3}>
          <FilterSidebar hideTopics={true} />
        </Box>
      </HStack>
    </GraphsLayout>
  );
}

export default withPermissionGuard("analytics:view")(MetricsContent);
