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
  useTheme,
  useToast,
} from "@chakra-ui/react";
import { addDays, format } from "date-fns";
import numeral from "numeral";
import { CheckCircle, XCircle } from "react-feather";
import {
  Area,
  AreaChart,
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
import { FilterSelector } from "../../components/FilterSelector";
import { useRouter } from "next/router";
import { useMemo } from "react";
import { rotatingColors } from "../../utils/rotatingColors";
import { getSingleQueryParam } from "../../utils/getSingleQueryParam";

type GraphsDataNumbers = Record<
  string,
  {
    currentPeriod: { date: string; value: number }[];
    previousPeriod: { date: string; value: number }[];
  }
>;

type GraphsDataTokens = Record<
  string,
  {
    currentPeriod: {
      date: string;
      prompt_tokens: number;
      completion_tokens: number;
    }[];
    previousPeriod: {
      date: string;
      prompt_tokens: number;
      completion_tokens: number;
    }[];
  }
>;

type GraphsData = {
  messages: GraphsDataNumbers;
  costs: GraphsDataNumbers;
  tokens: GraphsDataTokens;
};

export default function Index() {
  const { project } = useOrganizationTeamProject();
  const {
    period: { startDate, endDate },
    setPeriod,
    daysDifference,
  } = usePeriodSelector();
  const toast = useToast();
  const router = useRouter();

  const analytics = api.analytics.getTracesAnalyticsPerDay.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: addDays(startDate, -daysDifference).getTime(),
      endDate: endDate.getTime(),
      user_id: getSingleQueryParam(router.query.user_id),
      thread_id: getSingleQueryParam(router.query.thread_id),
      customer_ids: getSingleQueryParam(router.query.customer_ids)?.split(","),
      versions: getSingleQueryParam(router.query.versions)?.split(","),
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
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      user_id: getSingleQueryParam(router.query.user_id),
      thread_id: getSingleQueryParam(router.query.thread_id),
      customer_ids: getSingleQueryParam(router.query.customer_ids)?.split(","),
      versions: getSingleQueryParam(router.query.versions)?.split(","),
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
        startDate: startDate.getTime(),
        endDate: endDate.getTime(),
        user_id: getSingleQueryParam(router.query.user_id),
        thread_id: getSingleQueryParam(router.query.thread_id),
        customer_ids: getSingleQueryParam(router.query.customer_ids)?.split(
          ","
        ),
        versions: getSingleQueryParam(router.query.versions)?.split(","),
      },
      {
        enabled: !!project?.id && !!startDate && !!endDate,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      }
    );

  const { graphsData, messagesTotal, costsTotal, tokensTotal } = useMemo(() => {
    let messagesTotal = 0;
    let costsTotal = 0;
    let tokensTotal = 0;

    const graphsData = Object.entries(analytics.data ?? {}).reduce(
      (acc, [key, aggregation]) => {
        const data = aggregation.slice(daysDifference);
        const previousPeriod = aggregation.slice(0, daysDifference);

        messagesTotal += data.reduce((acc, curr) => acc + curr.count, 0);
        costsTotal += data.reduce((acc, curr) => acc + curr.total_cost, 0);
        tokensTotal += data.reduce(
          (acc, curr) => acc + curr.prompt_tokens + curr.completion_tokens,
          0
        );

        if (!acc.messages) acc.messages = {};
        acc.messages[key] = {
          currentPeriod: data.map((item) => ({
            date: item.date,
            value: item.count,
          })),
          previousPeriod: previousPeriod.map((item) => ({
            date: item.date,
            value: item.count,
          })),
        };

        if (!acc.costs) acc.costs = {};
        acc.costs[key] = {
          currentPeriod: data.map((item) => ({
            date: item.date,
            value: item.total_cost,
          })),
          previousPeriod: previousPeriod.map((item) => ({
            date: item.date,
            value: item.total_cost,
          })),
        };

        if (!acc.tokens) acc.tokens = {};
        acc.tokens[key] = {
          currentPeriod: data.map((item) => ({
            date: item.date,
            prompt_tokens: item.prompt_tokens,
            completion_tokens: item.completion_tokens,
          })),
          previousPeriod: previousPeriod.map((item) => ({
            date: item.date,
            prompt_tokens: item.prompt_tokens,
            completion_tokens: item.completion_tokens,
          })),
        };

        return acc;
      },
      {} as GraphsData
    );

    return { graphsData, messagesTotal, costsTotal, tokensTotal };
  }, [analytics.data, daysDifference]);

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
        <HStack width="full" paddingBottom={6}>
          <Spacer />
          <FilterSelector />
          <PeriodSelector
            period={{ startDate, endDate }}
            setPeriod={setPeriod}
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
                        <Text color="black">Total Cost</Text>
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
                        data={graphsData.messages}
                      />
                    </TabPanel>
                    <TabPanel>
                      <CurrentVsPreviousPeriodLineChart
                        data={graphsData.messages}
                      />
                    </TabPanel>
                    <TabPanel>
                      <TokensChart data={graphsData.tokens} />
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
                    label="Average Cost per Message"
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

const useGetRotatingColorForCharts = () => {
  const theme = useTheme();

  return (index: number) => {
    const [name, number] =
      rotatingColors[index % rotatingColors.length]!.color.split(".");
    return theme.colors[name ?? ""][+(number ?? "") - 200];
  };
};

function CurrentVsPreviousPeriodLineChart({
  data,
}: {
  data: GraphsDataNumbers | undefined;
}) {
  const getColor = useGetRotatingColorForCharts();
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];

  const formatDate = (date: string) => date && format(new Date(date), "MMM d");

  const mergedData: Record<string, number | string>[] = [];
  for (const [key, agg] of Object.entries(data ?? {})) {
    if (!data) continue;

    for (const [index, entry] of agg.currentPeriod.entries()) {
      if (!mergedData[index]) mergedData[index] = { date: entry.date };
      mergedData[index]![key] = entry.value;
    }
  }

  const currentAndPreviousData = data?.default?.previousPeriod?.map(
    (entry, index) => {
      return {
        ...data.default?.currentPeriod[index],
        previousValue: entry.value,
        previousDate: entry.date,
      };
    }
  );

  const Chart = data?.default ? LineChart : AreaChart;

  return (
    <ResponsiveContainer width="100%" height={300}>
      {data ? (
        <Chart
          data={currentAndPreviousData ? currentAndPreviousData : mergedData}
          margin={{ left: -10 }}
        >
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
                  (payload[1]?.payload.previousDate
                    ? " vs " + formatDate(payload[1]?.payload.previousDate)
                    : "")
                );
              }
            }}
          />
          <Legend />
          {data.default ? (
            <>
              <Line
                type="linear"
                dataKey="value"
                stroke={getColor(0)}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 8 }}
                name="Messages"
              />
              <Line
                type="linear"
                dataKey="previousValue"
                stroke="#ED892699"
                strokeWidth={2.5}
                strokeDasharray={"5 5"}
                dot={false}
                name="Previous Period"
              />
            </>
          ) : (
            Object.keys(data ?? {}).map((agg, index) => (
              <Area
                key={agg}
                type="linear"
                dataKey={agg}
                stroke={getColor(index)}
                fill={getColor(index)}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 8 }}
                name={agg}
              />
            ))
          )}
        </Chart>
      ) : (
        <div />
      )}
    </ResponsiveContainer>
  );
}

function TokensChart({ data }: { data: GraphsDataTokens | undefined }) {
  const getColor = useGetRotatingColorForCharts();
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];
  const orange400 = theme.colors.orange["400"];
  const blue400 = theme.colors.blue["400"];

  const formatDate = (date: string) => date && format(new Date(date), "MMM d");

  const mergedData: Record<string, number | string>[] = [];
  for (const [key, agg] of Object.entries(data ?? {})) {
    if (!data) continue;

    for (const [index, entry] of agg.currentPeriod.entries()) {
      if (!mergedData[index]) mergedData[index] = { date: entry.date };
      mergedData[index]![key] = entry.prompt_tokens + entry.completion_tokens;
    }
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={data?.default ? data.default.currentPeriod : mergedData}
        margin={{ left: -10 }}
      >
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
        {data?.default ? (
          <>
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
          </>
        ) : (
          Object.keys(data ?? {}).map((agg, index) => (
            <Bar
              key={agg}
              stackId="tokens"
              dataKey={agg}
              fill={getColor(index)}
              name={agg}
            />
          ))
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
