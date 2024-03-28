import {
  Box,
  Card,
  CardBody,
  CardHeader,
  GridItem,
  HStack,
  Heading,
  SimpleGrid
} from "@chakra-ui/react";
import { BarChart2 } from "react-feather";
import GraphsLayout from "~/components/GraphsLayout";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { AnalyticsHeader } from "../../../components/analytics/AnalyticsHeader";

const userCount = {
  graphId: "custom",
  graphType: "summary",
  series: [
    {
      name: "",
      colorSet: "blueTones",
      metric: "metadata.user_id",
      aggregation: "cardinality",
    },
  ],
  includePrevious: true,
  timeScale: 1,
  height: 550,
};

const LLMMetrics = {
  graphId: "custom",
  graphType: "summary",
  series: [
    {
      name: "LLM Calls",
      metric: "metadata.span_type",
      key: "llm",
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
  timeScale: 1,
  height: 300,
};

const LLMSummary = {
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
  timeScale: 1,
  height: 300,
};

const LLMs = {
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
  timeScale: 1,
  height: 300,
};

const llmUsage = {
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
  timeScale: 1,
  height: 300,
};

const completionTime = {
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

const totalCostPerModel = {
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

const averageTokensPerMessage = {
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

export default function Users() {
  return (
    <GraphsLayout>
      <AnalyticsHeader title="LLM Metrics" />
      <HStack alignItems={"start"}>
        <SimpleGrid
          templateColumns="repeat(4, 1fr)"
          gap={5}
          width={"100%"}
        >
          <GridItem colSpan={2} display={"inline-grid"}>
            <Card overflow={"scroll"}>
              <CardHeader>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">LLM Metrics</Heading>
                </HStack>
              </CardHeader>
              <CardBody>
                <CustomGraph input={LLMMetrics as CustomGraphInput} />
              </CardBody>
            </Card>
          </GridItem>
          <GridItem colSpan={2} display={"inline-grid"}>
            <Card overflow={"scroll"}>
              <CardHeader>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Summary</Heading>
                </HStack>
              </CardHeader>
              <CardBody>
                <CustomGraph input={LLMSummary as CustomGraphInput} />
              </CardBody>
            </Card>
          </GridItem>

          <GridItem colSpan={4} display={"inline-grid"}>
            <Card>
              <CardHeader>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">LLM Usage</Heading>
                </HStack>
              </CardHeader>
              <CardBody>
                <CustomGraph input={LLMs as CustomGraphInput} />
              </CardBody>
            </Card>
          </GridItem>
          <GridItem colSpan={2} display={"inline-grid"}>
            <Card>
              <CardHeader>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">LLM Split</Heading>
                </HStack>
              </CardHeader>
              <CardBody>
                <CustomGraph input={llmUsage as CustomGraphInput} />
              </CardBody>
            </Card>
          </GridItem>
          <GridItem colSpan={2} display={"inline-grid"}>
            <Card>
              <CardHeader>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Average Completion Time</Heading>
                </HStack>
              </CardHeader>
              <CardBody>
                <CustomGraph input={completionTime as CustomGraphInput} />
              </CardBody>
            </Card>
          </GridItem>
          <GridItem colSpan={2} display={"inline-grid"}>
            <Card>
              <CardHeader>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Average Cost Per Message</Heading>
                </HStack>
              </CardHeader>
              <CardBody>
                <CustomGraph input={totalCostPerModel as CustomGraphInput} />
              </CardBody>
            </Card>
          </GridItem>
          <GridItem colSpan={2} display={"inline-grid"}>
            <Card>
              <CardHeader>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Average Tokens Per Message</Heading>
                </HStack>
              </CardHeader>
              <CardBody>
                <CustomGraph
                  input={averageTokensPerMessage as CustomGraphInput}
                />
              </CardBody>
            </Card>
          </GridItem>
        </SimpleGrid>
        <Box padding={3}>
          <FilterSidebar hideTopics={true} />
        </Box>
      </HStack>
    </GraphsLayout>
  );
}
