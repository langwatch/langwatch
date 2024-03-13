import {
  Card,
  CardBody,
  Container,
  Grid,
  GridItem,
  HStack,
  SimpleGrid,
  Spacer,
  Text,
} from "@chakra-ui/react";
import GraphsLayout from "~/components/GraphsLayout";
import { PeriodSelector, usePeriodSelector } from "~/components/PeriodSelector";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import { DocumentsCountsTable } from "~/components/analytics/DocumentsCountsTable";
import { TopTopics } from "~/components/analytics/TopTopics";
import {
  FilterToggle,
  useFilterToggle,
} from "~/components/filters/FilterToggle";

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
      name: "Input sentiment score average",
      colorSet: "positiveNegativeNeutral",
      metric: "sentiment.input_sentiment",
      aggregation: "avg",
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
  timeScale: "1",
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
  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();
  const { showFilters } = useFilterToggle();

  return (
    <GraphsLayout>
      <Container maxWidth={showFilters ? "1300" : "1200"} padding={6}>
        <HStack width="full" marginBottom={3}>
          <Spacer />
          <FilterToggle />
          <PeriodSelector
            period={{ startDate, endDate }}
            setPeriod={setPeriod}
          />
        </HStack>
        <hr />
        <HStack paddingY={2}>
          <SimpleGrid
            templateColumns="repeat(3, 1fr)"
            gap={5}
            marginTop={4}
            width={"100%"}
          >
            <GridItem display={"inline-grid"}>
              <Card>
                <CardBody>
                  <Text fontWeight={"500"}>Threads per Topic</Text>
                  <CustomGraph input={threadsPerTopic as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardBody>
                  <Text fontWeight={"500"}>Input Sentiment per Topic</Text>
                  <CustomGraph
                    input={inputSentimenPerTopic as CustomGraphInput}
                  />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem display={"inline-grid"}>
              <Card>
                <CardBody>
                  <Text fontWeight={"500"}>Most Discussed Topics</Text>
                  <CustomGraph
                    input={mostDisucussedTopics as CustomGraphInput}
                  />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem colSpan={2}>
              <Card>
                <CardBody>
                  <DocumentsCountsTable />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem>
              <TopTopics />
            </GridItem>
            <GridItem display={"inline-grid"}>
              <Card>
                <CardBody>
                  <Text fontWeight={"500"}>Overall Input Sentiment</Text>
                  <CustomGraph input={inputSentiment as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>
          </SimpleGrid>
        </HStack>
      </Container>
    </GraphsLayout>
  );
}
