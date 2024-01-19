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
import numeral from "numeral";
import { CheckCircle, XCircle } from "react-feather";
import { DashboardLayout } from "~/components/DashboardLayout";
import { FilterSelector } from "../../components/FilterSelector";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../components/PeriodSelector";
import {
  LLMCallsCountGraph,
  LLMCallsCountSummary,
} from "../../components/analytics/LLMCallsCountGraph";
import {
  LLMCostSumGraph,
  LLMCostSumSummary,
} from "../../components/analytics/LLMCostSumGraph";
import {
  MessagesCountGraph,
  MessagesCountSummary,
} from "../../components/analytics/MessagesCountGraph";
import { SatisfactionPieChart } from "../../components/analytics/SatisfactionGraph";
import { SessionsSummary } from "../../components/analytics/SessionsSummary";
import {
  ThreadsCountGraph,
  ThreadsCountSummary,
} from "../../components/analytics/ThreadsCountGraph";
import {
  TokensSumGraph,
  TokensSumSummary,
} from "../../components/analytics/TokensGraph";
import { TopTopics } from "../../components/analytics/TopTopics";
import {
  UsersCountGraph,
  UsersCountSummary,
} from "../../components/analytics/UsersCountGraph";
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { LLMSummary } from "../../components/analytics/LLMSummary";
import { useRouter } from "next/router";
import { dependencies } from "../../injection/dependencies.client";
import { dependencies as serverDependencies } from "../../injection/dependencies.server";
import type { GetServerSidePropsContext } from "next";

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

  const { analyticsParams, queryOpts } = useAnalyticsParams();

  const traceCheckStatusCounts =
    api.analytics.getTraceCheckStatusCounts.useQuery(
      analyticsParams,
      queryOpts
    );

  return (
    <DashboardLayout>
      <Container maxWidth="1200" padding={6}>
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
        <HStack width="full" align="top">
          <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
            User Metrics
          </Heading>
          <Spacer />
          <FilterSelector />
          <PeriodSelector
            period={{ startDate, endDate }}
            setPeriod={setPeriod}
          />
        </HStack>
        <Grid
          width="100%"
          templateColumns={["1fr", "1fr", "1fr", "1fr 0.5fr"]}
          gap={6}
        >
          <GridItem>
            <Card>
              <CardBody>
                <Tabs variant="unstyled">
                  <TabList gap={12}>
                    <Tab paddingX={0} paddingBottom={4}>
                      <VStack align="start">
                        <Text color="black">Messages</Text>
                        <Box fontSize={24} color="black" fontWeight="bold">
                          <MessagesCountSummary />
                        </Box>
                      </VStack>
                    </Tab>
                    <Tab paddingX={0} paddingBottom={4}>
                      <VStack align="start">
                        <Text color="black">Threads</Text>
                        <Box fontSize={24} color="black" fontWeight="bold">
                          <ThreadsCountSummary />
                        </Box>
                      </VStack>
                    </Tab>
                    <Tab paddingX={0} paddingBottom={4}>
                      <VStack align="start">
                        <Text color="black">Users</Text>
                        <Box fontSize={24} color="black" fontWeight="bold">
                          <UsersCountSummary />
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
                    <TabPanel>
                      <MessagesCountGraph />
                    </TabPanel>
                    <TabPanel>
                      <ThreadsCountGraph />
                    </TabPanel>
                    <TabPanel>
                      <UsersCountGraph />
                    </TabPanel>
                  </TabPanels>
                </Tabs>
              </CardBody>
            </Card>
          </GridItem>
          <GridItem rowSpan={2}>
            <VStack spacing={6}>
              <TopTopics />
              <SatisfactionPieChart />
            </VStack>
          </GridItem>
          <GridItem>
            <SessionsSummary />
          </GridItem>
        </Grid>
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
                      <VStack align="start">
                        <Text color="black">LLM Calls</Text>
                        <Box fontSize={24} color="black" fontWeight="bold">
                          <LLMCallsCountSummary />
                        </Box>
                      </VStack>
                    </Tab>
                    <Tab paddingX={0} paddingBottom={4}>
                      <VStack align="start">
                        <Text color="black">Total Cost</Text>
                        <Box fontSize={24} color="black" fontWeight="bold">
                          <LLMCostSumSummary />
                        </Box>
                      </VStack>
                    </Tab>
                    <Tab paddingX={0} paddingBottom={4}>
                      <VStack align="start">
                        <Text color="black">Tokens</Text>
                        <Box fontSize={24} color="black" fontWeight="bold">
                          <TokensSumSummary />
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
                    <TabPanel>
                      <LLMCallsCountGraph />
                    </TabPanel>
                    <TabPanel>
                      <LLMCostSumGraph />
                    </TabPanel>
                    <TabPanel>
                      <TokensSumGraph />
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
                        numeral(traceCheckStatusCounts.data.failed).format(
                          "0a"
                        ) + " failed checks"
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
      </Container>
    </DashboardLayout>
  );
}
