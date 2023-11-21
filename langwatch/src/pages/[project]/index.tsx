import {
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
  useTheme,
  useToast,
} from "@chakra-ui/react";
import { addDays, endOfDay, format, startOfDay } from "date-fns";
import { useRouter } from "next/router";
import numeral from "numeral";
import { useEffect } from "react";
import { CheckCircle, XCircle } from "react-feather";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DashboardLayout } from "~/components/DashboardLayout";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../components/PeriodSelector";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { formatMilliseconds } from "../../utils/formatMilliseconds";

export default function Index() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { startDate, setStartDate, endDate, setEndDate, daysDifference } =
    usePeriodSelector();
  const toast = useToast();

  const analytics = api.analytics.getTracesAnalyticsPerDay.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: addDays(startDate, -daysDifference).getTime(),
      endDate: endOfDay(endDate).getTime(),
    },
    {
      enabled: !!project?.id && !!startDate && !!endDate,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      onError: () => {
        toast({
          title: "Sorry, something went wrong",
          description:
            "Error loading analytics, please try refreshing the page.",
          status: "error",
          duration: 5000,
          isClosable: true,
          position: "top-right",
        });
      },
    }
  );
  const usageMetrics = api.analytics.getUsageMetrics.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: startOfDay(startDate).getTime(),
      endDate: endOfDay(endDate).getTime(),
    },
    {
      enabled: !!project?.id && !!startDate && !!endDate,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );
  const traceCheckStatusCounts =
    api.analytics.getTraceCheckStatusCounts.useQuery(
      {
        projectId: project?.id ?? "",
        startDate: startOfDay(startDate).getTime(),
        endDate: endOfDay(endDate).getTime(),
      },
      {
        enabled: !!project?.id && !!startDate && !!endDate,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      }
    );
  const messagesData = analytics.data?.slice(daysDifference);
  const messagesPreviousPeriod = analytics.data?.slice(0, daysDifference);
  const messagesTotal = messagesData?.reduce(
    (acc, curr) => acc + curr.count,
    0
  );
  const costsData = analytics.data?.slice(daysDifference);
  const costsPreviousPeriod = analytics.data?.slice(0, daysDifference);
  const costsTotal = costsData?.reduce((acc, curr) => acc + curr.total_cost, 0);
  const tokensData = analytics.data?.slice(daysDifference);
  const tokensTotal = tokensData?.reduce(
    (acc, curr) => acc + curr.prompt_tokens + curr.completion_tokens,
    0
  );

  useEffect(() => {
    if (project && !project.firstMessage) {
      void router.push(`${project.slug}/messages`);
    }
  }, [project, router]);

  return (
    <DashboardLayout>
      <Container maxWidth="1200" padding={6}>
        <HStack width="full" paddingBottom={6}>
          <Spacer />
          <PeriodSelector
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            daysDifference={daysDifference}
          />
        </HStack>
        <Grid width="100%" templateColumns="1fr 0.5fr" gap={6}>
          <GridItem colSpan={2}>
            <Card>
              <CardBody>
                <Tabs variant="unstyled">
                  <TabList gap={12}>
                    <Tab paddingX={0} paddingBottom={4}>
                      <VStack align="start">
                        <Text color="black">Messages</Text>
                        <Box fontSize={24} color="black" fontWeight="bold">
                          {messagesTotal !== undefined ? (
                            numeral(messagesTotal).format("0a")
                          ) : (
                            <Box paddingY="0.25em">
                              <Skeleton height="1em" width="80px" />
                            </Box>
                          )}
                        </Box>
                      </VStack>
                    </Tab>
                    <Tab paddingX={0} paddingBottom={4}>
                      <VStack align="start">
                        <Text color="black">Cost</Text>
                        <Box fontSize={24} color="black" fontWeight="bold">
                          {costsTotal !== undefined ? (
                            numeral(costsTotal).format("$0.00a")
                          ) : (
                            <Box paddingY="0.25em">
                              <Skeleton height="1em" width="80px" />
                            </Box>
                          )}
                        </Box>
                      </VStack>
                    </Tab>
                    <Tab paddingX={0} paddingBottom={4}>
                      <VStack align="start">
                        <Text color="black">Tokens</Text>
                        <Box fontSize={24} color="black" fontWeight="bold">
                          {tokensTotal !== undefined ? (
                            numeral(tokensTotal).format("0a")
                          ) : (
                            <Box paddingY="0.25em">
                              <Skeleton height="1em" width="80px" />
                            </Box>
                          )}
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
                      <CurrentVsPreviousPeriodLineChart
                        data={messagesData}
                        previousPeriod={messagesPreviousPeriod}
                        dataKey="count"
                      />
                    </TabPanel>
                    <TabPanel>
                      <CurrentVsPreviousPeriodLineChart
                        data={costsData}
                        previousPeriod={costsPreviousPeriod}
                        dataKey="total_cost"
                      />
                    </TabPanel>
                    <TabPanel>
                      <TokensChart data={tokensData} />
                    </TabPanel>
                  </TabPanels>
                </Tabs>
              </CardBody>
            </Card>
          </GridItem>
          <GridItem>
            <Card>
              <CardHeader>
                <Heading size="sm">Summary</Heading>
              </CardHeader>
              <CardBody>
                <HStack spacing={0}>
                  <SummaryMetric
                    label="Average Total Tokens per Message"
                    value={
                      usageMetrics.data &&
                      numeral(usageMetrics.data.avg_tokens_per_trace).format(
                        "0a"
                      )
                    }
                  />
                  <SummaryMetric
                    label="Average Total Cost / 1000 Messages"
                    value={
                      usageMetrics.data &&
                      numeral(
                        usageMetrics.data.avg_total_cost_per_1000_traces
                      ).format("$0.00a")
                    }
                  />
                  {(!usageMetrics.data ||
                    usageMetrics.data.percentile_90th_time_to_first_token >
                      0) && (
                    <SummaryMetric
                      label="90th Percentile Time to First Token"
                      value={
                        usageMetrics.data &&
                        formatMilliseconds(
                          usageMetrics.data.percentile_90th_time_to_first_token
                        )
                      }
                    />
                  )}
                  <SummaryMetric
                    label="90th Percentile Total Response Time"
                    value={
                      usageMetrics.data &&
                      (!!usageMetrics.data.percentile_90th_total_time_ms
                        ? formatMilliseconds(
                            usageMetrics.data.percentile_90th_total_time_ms
                          )
                        : "-")
                    }
                  />
                </HStack>
              </CardBody>
            </Card>
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

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}) {
  return (
    <VStack
      maxWidth="180"
      spacing={4}
      align="start"
      borderLeftWidth="1px"
      borderLeftColor="gray.300"
      paddingX={4}
      _first={{ paddingLeft: 0, borderLeft: "none" }}
    >
      <Heading
        fontSize="13"
        color="gray.500"
        fontWeight="normal"
        lineHeight="1.5em"
      >
        {label}
      </Heading>
      <Box fontSize="28" fontWeight="600">
        {value ? (
          value
        ) : (
          <Box paddingY="0.25em">
            <Skeleton height="1em" width="80px" />
          </Box>
        )}
      </Box>
    </VStack>
  );
}

function CurrentVsPreviousPeriodLineChart<T extends string>({
  dataKey,
  data,
  previousPeriod,
}: {
  dataKey: T;
  data: ({ date: string } & Record<T, number>)[] | undefined;
  previousPeriod: ({ date: string } & Record<T, number>)[] | undefined;
}) {
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];
  const orange400 = theme.colors.orange["400"];

  const mergedData =
    data &&
    previousPeriod?.map((entry, index) => {
      return {
        ...data[index],
        previousPeriod: entry[dataKey],
        previousDate: entry.date,
      };
    });
  const formatDate = (date: string) => date && format(new Date(date), "MMM d");

  return (
    <ResponsiveContainer width="100%" height={300}>
      {mergedData ? (
        <LineChart data={mergedData} margin={{ left: -10 }}>
          <CartesianGrid vertical={false} strokeDasharray="5 7" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tickLine={false}
            axisLine={false}
            tick={{ fill: gray400 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tickCount={4}
            tickMargin={20}
            domain={[0, "dataMax"]}
            tick={{ fill: gray400 }}
          />
          <Tooltip
            labelFormatter={(_label, payload) => {
              if (payload && payload.length == 1) {
                return formatDate(payload[0]?.payload.date);
              }
              if (payload && payload.length == 2) {
                return (
                  formatDate(payload[0]?.payload.date) +
                  " vs " +
                  formatDate(payload[1]?.payload.previousDate)
                );
              }
            }}
          />
          <Legend />
          <Line
            type="linear"
            dataKey={dataKey}
            stroke={orange400}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 8 }}
            name="Messages"
          />
          <Line
            type="linear"
            dataKey="previousPeriod"
            stroke="#ED892699"
            strokeWidth={2.5}
            strokeDasharray={"5 5"}
            dot={false}
            name="Previous Period"
          />
        </LineChart>
      ) : (
        <div />
      )}
    </ResponsiveContainer>
  );
}

function TokensChart({
  data,
}: {
  data:
    | { date: string; prompt_tokens: number; completion_tokens: number }[]
    | undefined;
}) {
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];
  const orange400 = theme.colors.orange["400"];
  const blue400 = theme.colors.blue["400"];

  const formatDate = (date: string) => date && format(new Date(date), "MMM d");

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ left: -10 }}>
        <CartesianGrid vertical={false} strokeDasharray="5 7" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tickLine={false}
          axisLine={false}
          tick={{ fill: gray400 }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tickCount={4}
          tickMargin={20}
          domain={[0, "dataMax"]}
          tick={{ fill: gray400 }}
        />
        <Tooltip labelFormatter={formatDate} />
        <Legend />
        <Bar
          stackId="tokens"
          dataKey="prompt_tokens"
          fill={blue400}
          name="Prompt Tokens"
        />
        <Bar
          stackId="tokens"
          dataKey="completion_tokens"
          fill={orange400}
          name="Completion Tokens"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
