import {
  Card,
  CardBody,
  CardHeader,
  Container,
  Grid,
  GridItem,
  Heading,
  Tab,
  TabIndicator,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  VStack,
  useTheme,
} from "@chakra-ui/react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useRouter } from "next/router";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Bar,
  BarChart,
} from "recharts";
import { format } from "date-fns";
import { useEffect } from "react";
import { api } from "../../utils/api";
import { UTF8WhitespaceHolder } from "../../components/misc/UTF8WhitespaceHolder";
import numeral from "numeral";

const endDate = new Date();
const startDate = new Date();
startDate.setDate(endDate.getDate() - 30 + 1);

export default function Index() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const analytics = api.analytics.getTracesAnalyticsPerDay.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    { enabled: !!project?.id }
  );
  const messagesData = analytics.data?.slice(15);
  const messagesPreviousPeriod = analytics.data?.slice(0, 15);
  const messagesTotal = analytics.data?.reduce(
    (acc, curr) => acc + curr.count,
    0
  );
  const costsData = analytics.data?.slice(15);
  const costsPreviousPeriod = analytics.data?.slice(0, 15);
  const costsTotal = analytics.data?.reduce(
    (acc, curr) => acc + curr.total_cost,
    0
  );
  const tokensData = analytics.data?.slice(15);
  const tokensTotal = analytics.data?.reduce(
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
        <Grid width="100%" templateColumns="1fr 0.5fr" gap={6}>
          <GridItem>
            <Card>
              <CardBody>
                <Tabs variant="unstyled">
                  <TabList gap={12}>
                    <Tab paddingX={0} paddingBottom={4}>
                      <VStack align="start">
                        <Text color="black">Messages</Text>
                        <Text fontSize={24} color="black" fontWeight="bold">
                          {messagesTotal !== undefined ? (
                            numeral(messagesTotal).format("0a")
                          ) : (
                            <UTF8WhitespaceHolder />
                          )}
                        </Text>
                      </VStack>
                    </Tab>
                    <Tab paddingX={0} paddingBottom={4}>
                      <VStack align="start">
                        <Text color="black">Cost</Text>
                        <Text fontSize={24} color="black" fontWeight="bold">
                          {costsTotal !== undefined ? (
                            numeral(costsTotal).format("$0.00a")
                          ) : (
                            <UTF8WhitespaceHolder />
                          )}
                        </Text>
                      </VStack>
                    </Tab>
                    <Tab paddingX={0} paddingBottom={4}>
                      <VStack align="start">
                        <Text color="black">Tokens</Text>
                        <Text fontSize={24} color="black" fontWeight="bold">
                          {tokensTotal !== undefined ? (
                            numeral(tokensTotal).format("0a")
                          ) : (
                            <UTF8WhitespaceHolder />
                          )}
                        </Text>
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
                <Heading size="sm">Main Topics</Heading>
              </CardHeader>
              <CardBody>TODO</CardBody>
            </Card>
          </GridItem>
          <GridItem>
            <Card>
              <CardHeader>
                <Heading size="sm">Business</Heading>
              </CardHeader>
              <CardBody>TODO</CardBody>
            </Card>
          </GridItem>
          <GridItem>
            <Card>
              <CardHeader>
                <Heading size="sm">Validation Summary</Heading>
              </CardHeader>
              <CardBody>TODO</CardBody>
            </Card>
          </GridItem>
        </Grid>
      </Container>
    </DashboardLayout>
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
    (data &&
      previousPeriod?.map((entry, index) => {
        return {
          ...data[index],
          previousPeriod: entry[dataKey],
          previousDate: entry.date,
        };
      })) ??
    [];
  const formatDate = (date: string) => date && format(new Date(date), "MMM d");

  return (
    <ResponsiveContainer width="100%" height={300}>
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
