import {
  Box,
  Card,
  CardBody,
  CardHeader,
  GridItem,
  HStack,
  Heading,
  SimpleGrid,
} from "@chakra-ui/react";
import { BarChart2 } from "react-feather";
import GraphsLayout from "~/components/GraphsLayout";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import {
  DocumentsCountsSummary,
  DocumentsCountsTable,
} from "~/components/analytics/DocumentsCountsTable";
import { TopTopics } from "~/components/analytics/TopTopics";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { AnalyticsHeader } from "../../../components/analytics/AnalyticsHeader";
import { TopicsSelector } from "../../../components/filters/TopicsSelector";

const threadsPerTopic = {
  graphId: "custom",
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
  timeScale: 1,
  height: 300,
};

const inputSentimenPerTopic = {
  graphId: "custom",
  graphType: "horizontal_bar",
  series: [
    {
      name: "",
      colorSet: "greenTones",
      metric: "sentiment.input_sentiment",
      aggregation: "median",
      pipeline: {
        field: "trace_id",
        aggregation: "avg",
      },
    },
  ],
  groupBy: "topics.topics",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

const mostDisucussedTopics = {
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
  groupBy: "topics.topics",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

const inputSentiment = {
  graphId: "custom",
  graphType: "donnut",
  series: [
    {
      name: "Sum messages count per message",
      colorSet: "positiveNegativeNeutral",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      pipeline: {
        field: "trace_id",
        aggregation: "sum",
      },
    },
  ],
  groupBy: "sentiment.input_sentiment",
  includePrevious: false,
  timeScale: "full",
  height: 300,
};

export default function Topics() {
  return (
    <GraphsLayout>
      <AnalyticsHeader title="Topics" />
      <HStack alignItems={"start"}>
        <SimpleGrid templateColumns="repeat(4, 1fr)" gap={5} width={"100%"}>
          <GridItem colSpan={1}>
            <Card height="100%">
              <CardHeader>
                <Heading size="sm">Top Topics</Heading>
              </CardHeader>
              <CardBody>
                <TopicsSelector showTitle={false} />
              </CardBody>
            </Card>
          </GridItem>
          <GridItem colSpan={3} display={"inline-grid"}>
            <Card>
              <CardHeader>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Threads Per Topic</Heading>
                </HStack>
              </CardHeader>
              <CardBody>
                <CustomGraph input={threadsPerTopic as CustomGraphInput} />
              </CardBody>
            </Card>
          </GridItem>
          <GridItem colSpan={2} display={"inline-grid"}>
            <Card>
              <CardHeader>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Input Sentiment Per Topic</Heading>
                </HStack>
              </CardHeader>
              <CardBody>
                <CustomGraph
                  input={inputSentimenPerTopic as CustomGraphInput}
                />
              </CardBody>
            </Card>
          </GridItem>
          <GridItem colSpan={2} display={"inline-grid"}>
            <Card>
              <CardHeader>
                <HStack>
                  <BarChart2 color="orange" />
                  <Heading size="sm">Most Discussed Topics</Heading>
                </HStack>
              </CardHeader>
              <CardBody>
                <CustomGraph input={mostDisucussedTopics as CustomGraphInput} />
              </CardBody>
            </Card>
          </GridItem>
          <GridItem colSpan={4}>
            <Card>
              <CardBody>
                <HStack>
                  <Heading size="sm"> Total documents</Heading>
                </HStack>

                <DocumentsCountsSummary />
                <DocumentsCountsTable />
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
