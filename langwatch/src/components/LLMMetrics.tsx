import {
  Box,
  Card,
  CardBody,
  CardHeader,
  Grid,
  GridItem,
  HStack,
  Heading,
  Skeleton,
  Tab,
  TabIndicator,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  VStack,
} from "@chakra-ui/react";
import numeral from "numeral";
import { CheckCircle, XCircle } from "react-feather";
import { CustomGraph, type CustomGraphInput } from "./analytics/CustomGraph";
import { LLMSummary } from "./analytics/LLMSummary";
import { useFilterParams } from "../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { analyticsMetrics } from "../server/analytics/registry";
import { TeamRoleGroup } from "../server/api/permission";
import { api } from "../utils/api";

export function LLMMetrics() {
  const { filterParams, queryOpts } = useFilterParams();
  const traceCheckStatusCounts =
    api.analytics.getTraceCheckStatusCounts.useQuery(filterParams, queryOpts);
  const { hasTeamPermission } = useOrganizationTeamProject();

  const llmCallsGraph: CustomGraphInput = {
    graphId: "llmCallsGraph",
    graphType: "area",
    series: [
      {
        name: "LLM Calls",
        metric: "metadata.span_type",
        key: "llm",
        aggregation: "cardinality",
        colorSet: "colors",
      },
    ],
    groupBy: "metadata.model",
    includePrevious: false,
    timeScale: 1,
  };

  const totalCostGraph: CustomGraphInput = {
    graphId: "totalCostGraph",
    graphType: "line",
    series: [
      {
        name: analyticsMetrics.performance.total_cost.label,
        metric: "performance.total_cost",
        aggregation: "sum",
        colorSet: analyticsMetrics.performance.total_cost.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: true,
    timeScale: 1,
  };

  const totalTokensSummary: CustomGraphInput = {
    graphId: "totalTokensSummary",
    graphType: "summary",
    series: [
      {
        name: "Tokens",
        metric: "performance.total_tokens",
        aggregation: "sum",
        colorSet: analyticsMetrics.performance.total_tokens.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: false,
    timeScale: "full",
  };

  const tokensGraph: CustomGraphInput = {
    graphId: "tokensGraph",
    graphType: "stacked_bar",
    series: [
      {
        name: analyticsMetrics.performance.prompt_tokens.label,
        metric: "performance.prompt_tokens",
        aggregation: "sum",
        colorSet: analyticsMetrics.performance.prompt_tokens.colorSet,
      },
      {
        name: analyticsMetrics.performance.completion_tokens.label,
        metric: "performance.completion_tokens",
        aggregation: "sum",
        colorSet: analyticsMetrics.performance.completion_tokens.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: false,
    timeScale: 1,
  };

  return (
    <>
      <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={10}>
        LLM Metrics
      </Heading>
      <Grid width="100%" templateColumns="1fr 0.5fr" gap={6}>
        <GridItem colSpan={2}>
          <Card>
            <CardBody>
              <Tabs variant="unstyled">
                <TabList gap={12}>
                  <Tab paddingX={0} paddingBottom={4}>
                    <CustomGraph
                      input={{
                        ...llmCallsGraph,
                        graphType: "summary",
                        groupBy: undefined,
                      }}
                      titleProps={{
                        fontSize: 16,
                        color: "black",
                      }}
                    />
                  </Tab>
                  {hasTeamPermission(TeamRoleGroup.COST_VIEW) && (
                    <Tab paddingX={0} paddingBottom={4}>
                      <CustomGraph
                        input={{ ...totalCostGraph, graphType: "summary" }}
                        titleProps={{
                          fontSize: 16,
                          color: "black",
                        }}
                      />
                    </Tab>
                  )}
                  <Tab paddingX={0} paddingBottom={4}>
                    <VStack align="start">
                      <CustomGraph
                        input={totalTokensSummary}
                        titleProps={{
                          fontSize: 16,
                          color: "black",
                        }}
                      />
                    </VStack>
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
                    <CustomGraph input={llmCallsGraph} />
                  </TabPanel>
                  {hasTeamPermission(TeamRoleGroup.COST_VIEW) && (
                    <TabPanel>
                      <CustomGraph input={totalCostGraph} />
                    </TabPanel>
                  )}
                  <TabPanel>
                    <CustomGraph input={tokensGraph} />
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </CardBody>
          </Card>
        </GridItem>
        <GridItem>
          <LLMSummary />
        </GridItem>
        <GridItem>
          <Card height="full">
            <CardHeader>
              <Heading size="sm">Validation Summary</Heading>
            </CardHeader>
            <CardBody>
              <VStack align="start" spacing={4}>
                <HStack>
                  <Box color="red.600">
                    <XCircle />
                  </Box>
                  <Box>
                    {traceCheckStatusCounts.data ? (
                      numeral(traceCheckStatusCounts.data.failed).format("0a") +
                      " failed checks"
                    ) : (
                      <Skeleton height="1em" width="140px" />
                    )}
                  </Box>
                </HStack>
                <HStack>
                  <Box color="green.600">
                    <CheckCircle />
                  </Box>
                  <Box>
                    {traceCheckStatusCounts.data ? (
                      numeral(traceCheckStatusCounts.data.succeeded).format(
                        "0a"
                      ) + " successful checks"
                    ) : (
                      <Skeleton height="1em" width="170px" />
                    )}
                  </Box>
                </HStack>
              </VStack>
            </CardBody>
          </Card>
        </GridItem>
      </Grid>
    </>
  );
}
