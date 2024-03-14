import { CustomGraph, type CustomGraphInput } from "./CustomGraph";
import { analyticsMetrics } from "../../server/analytics/registry";
import {
  GridItem,
  Card,
  CardBody,
  Tabs,
  TabList,
  TabIndicator,
  TabPanels,
  TabPanel,
  VStack,
  Tab,
  Grid,
} from "@chakra-ui/react";

import { SatisfactionGraphs } from "./SatisfactionGraph";
import { SessionsSummary } from "./SessionsSummary";
import { TopTopics } from "./TopTopics";

export function UserMetrics() {
  const messagesGraph: CustomGraphInput = {
    graphId: "messagesCountGraph",
    graphType: "line",
    series: [
      {
        name: "Messages",
        metric: "metadata.trace_id",
        aggregation: "cardinality",
        colorSet: analyticsMetrics.metadata.trace_id.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: true,
    timeScale: 1,
  };

  const threadsGraph: CustomGraphInput = {
    graphId: "threadsCountGraph",
    graphType: "line",
    series: [
      {
        name: "Threads",
        metric: "metadata.thread_id",
        aggregation: "cardinality",
        colorSet: analyticsMetrics.metadata.thread_id.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: true,
    timeScale: 1,
  };

  const usersGraph: CustomGraphInput = {
    graphId: "usersCountGraph",
    graphType: "line",
    series: [
      {
        name: "Users",
        metric: "metadata.user_id",
        aggregation: "cardinality",
        colorSet: analyticsMetrics.metadata.user_id.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: true,
    timeScale: 1,
  };

  return (
    <Grid
      width="full"
      templateColumns={[
        "minmax(350px, 1fr)",
        "minmax(350px, 1fr)",
        "minmax(350px, 1fr)",
        "minmax(350px, 2fr) minmax(250px, 1fr)",
      ]}
      gap={6}
    >
      <GridItem>
        <Card>
          <CardBody>
            <Tabs variant="unstyled">
              <TabList gap={8}>
                <Tab paddingX={0} paddingBottom={4}>
                  <CustomGraph
                    input={{ ...messagesGraph, graphType: "summary" }}
                    titleProps={{
                      fontSize: 16,
                      color: "black",
                    }}
                  />
                </Tab>
                <Tab paddingX={0} paddingBottom={4}>
                  <CustomGraph
                    input={{ ...threadsGraph, graphType: "summary" }}
                    titleProps={{
                      fontSize: 16,
                      color: "black",
                    }}
                  />
                </Tab>
                <Tab paddingX={0} paddingBottom={4}>
                  <CustomGraph
                    input={{ ...usersGraph, graphType: "summary" }}
                    titleProps={{
                      fontSize: 16,
                      color: "black",
                    }}
                  />
                </Tab>
              </TabList>
              <TabIndicator
                mt="-1.5px"
                height="4px"
                bg="orange.400"
                borderRadius="1px"
              />
              <TabPanels>
                <TabPanel>
                  <CustomGraph input={messagesGraph} />
                </TabPanel>
                <TabPanel>
                  <CustomGraph input={threadsGraph} />
                </TabPanel>
                <TabPanel>
                  <CustomGraph input={usersGraph} />
                </TabPanel>
              </TabPanels>
            </Tabs>
          </CardBody>
        </Card>
      </GridItem>
      <GridItem rowSpan={2}>
        <VStack spacing={6}>
          <TopTopics />
          <SatisfactionGraphs />
        </VStack>
      </GridItem>
      <GridItem>
        <SessionsSummary />
      </GridItem>
    </Grid>
  );
}
