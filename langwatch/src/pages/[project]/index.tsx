import { Link } from "@chakra-ui/next-js";
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Box,
  Button,
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
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import type { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import numeral from "numeral";
import { CheckCircle, MessageSquare, XCircle } from "react-feather";
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
import { UserMetrics } from "../../components/analytics/UserMetrics";
import { FilterSidebar } from "../../components/filters/FilterSidebar";
import {
  FilterToggle,
  useFilterToggle,
} from "../../components/filters/FilterToggle";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { dependencies } from "../../injection/dependencies.client";
import { dependencies as serverDependencies } from "../../injection/dependencies.server";
import { analyticsMetrics } from "../../server/analytics/registry";
import { TeamRoleGroup } from "../../server/api/permission";
import { api } from "../../utils/api";

import GraphsLayout from "~/components/GraphsLayout";

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
  const router = useRouter();

  return (
    <GraphsLayout>
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
          <HStack width="full" align="top" paddingBottom={6}>
            <HStack align="center" spacing={6}>
              <Heading as={"h1"} size="lg" paddingTop={1}>
                Analytics
              </Heading>
              <Tooltip label="Show messages behind those metrics">
                <Button
                  variant="outline"
                  minWidth={0}
                  height="32px"
                  padding={2}
                  marginTop={2}
                  onClick={() => {
                    void router.push(
                      {
                        pathname: `/${project?.slug}/messages`,
                        query: {
                          ...router.query,
                        },
                      },
                      undefined,
                      { shallow: true }
                    );
                  }}
                >
                  <MessageSquare size="16" />
                </Button>
              </Tooltip>
            </HStack>
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
    </GraphsLayout>
  );
}

function LLMMetrics() {
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
