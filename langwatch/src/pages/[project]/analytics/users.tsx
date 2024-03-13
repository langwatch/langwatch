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
import { SessionsSummary } from "~/components/analytics/SessionsSummary";
import {
  FilterToggle,
  useFilterToggle,
} from "~/components/filters/FilterToggle";

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
      name: "Average msgs per user",
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
  ],
  includePrevious: false,
  timeScale: 1,
  height: 300,
};

const threadCount = {
  graphId: "custom",
  graphType: "summary",
  series: [
    {
      name: "",
      colorSet: "greenTones",
      metric: "metadata.thread_id",
      aggregation: "cardinality",
    },
  ],
  includePrevious: false,
  timeScale: 1,
  height: 550,
};

const averageCount = {
  graphId: "custom",
  graphType: "summary",
  series: [
    {
      name: "",
      colorSet: "orangeTones",
      metric: "metadata.trace_id",
      aggregation: "cardinality",
      pipeline: {
        field: "user_id",
        aggregation: "avg",
      },
    },
  ],
  includePrevious: false,
  timeScale: 1,
  height: 550,
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
  timeScale: "1",
  height: 200,
};

const dailyActiveThreads = {
  graphId: "custom",
  graphType: "line",
  series: [
    {
      name: "Threads count",
      colorSet: "greenTones",
      metric: "metadata.thread_id",
      aggregation: "cardinality",
    },
  ],
  includePrevious: true,
  timeScale: 1,
  height: 200,
};

const dailyActiveThreadsPerUser = {
  graphId: "custom",
  graphType: "summary",
  series: [
    {
      name: "",
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
  timeScale: 1,
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
  timeScale: "1",
  height: 300,
};

const messageSentiment = {
  graphId: "custom",
  graphType: "stacked_area",
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
  timeScale: 1,
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

export default function Users() {
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
            templateColumns="repeat(4, 1fr)"
            gap={5}
            marginTop={4}
            width={"100%"}
          >
            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardBody>
                  <Text fontWeight={"bold"} marginBottom={4}>
                    User Messages
                  </Text>
                  <CustomGraph input={messagesCount as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem colSpan={2} display={"inline-grid"}>
              <SessionsSummary />
            </GridItem>

            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardBody>
                  <Text fontWeight={"500"}>Daily Users</Text>
                  <CustomGraph input={userCountGrapgh as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardBody>
                  <Text fontWeight={"500"}>Daily Threads</Text>
                  <CustomGraph input={dailyActiveThreads as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>

            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardBody>
                  <Text fontWeight={"500"}>User Satisfaction</Text>
                  <CustomGraph input={messageSentiment as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardBody>
                  <Text fontWeight={"500"}>Average Daily Threads per User</Text>
                  <CustomGraph
                    input={averageDailyThreadsPerUser as CustomGraphInput}
                  />
                </CardBody>
              </Card>
            </GridItem>
            <GridItem colSpan={2} display={"inline-grid"}>
              <Card>
                <CardBody>
                  <Text fontWeight={"500"}>Power Users</Text>
                  <CustomGraph input={powerUsers as CustomGraphInput} />
                </CardBody>
              </Card>
            </GridItem>
          </SimpleGrid>
        </HStack>
      </Container>
    </GraphsLayout>
  );
}
