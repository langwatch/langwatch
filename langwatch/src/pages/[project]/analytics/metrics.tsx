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
  graphId: "custom",
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
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

const LLMSummary: CustomGraphInput = {
  graphId: "custom",
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
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 300,
};

const LLMs: CustomGraphInput = {
  graphId: "custom",
  graphType: "area",
  series: [
    {
      name: "90th Percentile Completion Time",
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

const llmUsage: CustomGraphInput = {
  graphId: "custom",
  graphType: "donnut",
  series: [
    {
      name: "90th Percentile Completion Time",
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
  graphId: "custom",
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
  graphId: "custom",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Average total cost average per message",
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
  graphId: "custom",
  graphType: "horizontal_bar",
  series: [
    {
      name: "Average completion tokens average per message",
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
            <CustomGraph input={LLMs} />
          </ChartCard>
          <ChartCard title="LLM Split" colSpan={2}>
            <CustomGraph input={llmUsage} />
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
            <CustomGraph
              input={averageTokensPerMessage}
            />
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
