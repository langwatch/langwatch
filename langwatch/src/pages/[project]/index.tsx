import { Link } from "@chakra-ui/next-js";
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Box,
  Card,
  CardBody,
  CardHeader,
  Container,
  Grid,
  GridItem,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Tab,
  TabIndicator,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import numeral from "numeral";
import { CheckCircle, XCircle } from "react-feather";
import { DashboardLayout } from "~/components/DashboardLayout";
import {
  FilterToggle,
  useFilterToggle,
} from "../../components/filters/FilterToggle";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../components/PeriodSelector";
import {
  CustomGraph,
  type CustomGraphInput,
} from "../../components/analytics/CustomGraph";
import {
  DocumentsCountsSummary,
  DocumentsCountsTable,
} from "../../components/analytics/DocumentsCountsTable";
import { LLMSummary } from "../../components/analytics/LLMSummary";
import { SatisfactionGraphs } from "../../components/analytics/SatisfactionGraph";
import { SessionsSummary } from "../../components/analytics/SessionsSummary";
import { TopTopics } from "../../components/analytics/TopTopics";
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { dependencies } from "../../injection/dependencies.client";
import { dependencies as serverDependencies } from "../../injection/dependencies.server";
import { analyticsMetrics } from "../../server/analytics/registry";
import { TeamRoleGroup } from "../../server/api/permission";
import { api } from "../../utils/api";
import { FilterSidebar } from "../../components/filters/FilterSidebar";
import { useFilterParams } from "../../hooks/useFilterParams";

export default function ProjectRouter() {
  const router = useRouter();

  const path =
    "/" +
    (typeof router.query.project == "string" ? router.query.project : "/");

  const Page = dependencies.extraPagesRoutes?.[path];
  if (Page) {
    return <Page />;
  }

  return Index();
}

export const getServerSideProps = async (
  context: GetServerSidePropsContext
) => {
  const path =
    "/" +
    (typeof context.query.project == "string" ? context.query.project : "/");

  const serverSideProps =
    serverDependencies.extraPagesGetServerSideProps?.[path];
  if (serverSideProps) {
    return serverSideProps(context);
  }

  return {
    props: {},
  };
};

function Index() {
  const { project } = useOrganizationTeamProject();
  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();
  const { showFilters } = useFilterToggle();

  return (
    <DashboardLayout>
      <Container maxWidth={showFilters ? "1612" : "1200"} padding={6}>
        {project && !project.firstMessage && (
          <Alert status="warning" variant="left-accent" marginBottom={6}>
            <AlertIcon alignSelf="start" />
            <VStack align="start">
              <AlertTitle>Setup pending</AlertTitle>
              <AlertDescription>
                <Text as="span">
                  {
                    "Your project is not set up yet so you won't be able to see any data on the dashboard, please go to the "
                  }
                </Text>
                <Link
                  textDecoration="underline"
                  href={`/${project.slug}/messages`}
                >
                  setup
                </Link>
                <Text as="span"> page to get started.</Text>
              </AlertDescription>
            </VStack>
          </Alert>
        )}
        <Container maxWidth="1152" padding={0}>
          <HStack width="full" align="top">
            <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
              User Metrics
            </Heading>
            <Spacer />
            <FilterToggle />
            <PeriodSelector
              period={{ startDate, endDate }}
              setPeriod={setPeriod}
            />
          </HStack>
        </Container>
        <HStack align="start" width="full" spacing={8}>
          <VStack align="start" width="full">
            <UserMetrics />
            <LLMMetrics />
            <DocumentsMetrics />
          </VStack>
          <FilterSidebar hideTopics={true} />
        </HStack>
      </Container>
    </DashboardLayout>
  );
}

function UserMetrics() {
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

function LLMMetrics() {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const traceCheckStatusCounts =
    api.analytics.getTraceCheckStatusCounts.useQuery(
      analyticsParams,
      queryOpts
    );
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
                        input={{ ...tokensGraph, graphType: "summary" }}
                        titleProps={{
                          fontSize: 16,
                          color: "black",
                        }}
                        sumSummariesUnderTitle="Tokens"
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

function DocumentsMetrics() {
  const { filterParams, queryOpts } = useFilterParams();
  const documents = api.analytics.topUsedDocuments.useQuery(
    filterParams,
    queryOpts
  );

  const count = documents.data?.totalUniqueDocuments;

  if (!count || count === 0) {
    return null;
  }

  return (
    <>
      <HStack width="full" align="top">
        <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={10}>
          Documents
        </Heading>
      </HStack>
      <Card>
        <CardBody>
          <Tabs variant="unstyled">
            <TabList gap={12}>
              <Tab paddingX={0} paddingBottom={4}>
                <VStack align="start">
                  <Text color="black">Total documents</Text>
                  <Box fontSize={24} color="black" fontWeight="bold">
                    <DocumentsCountsSummary />
                  </Box>
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
              <TabPanel paddingX={0}>
                <DocumentsCountsTable />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </CardBody>
      </Card>
    </>
  );
}
