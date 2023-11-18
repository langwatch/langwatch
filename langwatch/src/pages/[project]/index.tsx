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
} from "recharts";
import { format } from "date-fns";
import { useEffect } from "react";
import { api } from "../../utils/api";
import { formatLargeNumbers } from "../../utils/formatLargeNumbers";
import { UTF8WhitespaceHolder } from "../../components/misc/UTF8WhitespaceHolder";
import numeral from "numeral";

export default function Index() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const analytics = api.analytics.getTracesAnalyticsPerDay.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id }
  );
  const messagesData = analytics.data
    ?.slice(15)
    .map((entry) => ({ date: entry.date, count: entry.count }));
  const messagesPreviousPeriod = analytics.data
    ?.slice(0, 15)
    .map((entry) => ({ date: entry.date, count: entry.count }));
  const messagesTotal = analytics.data?.reduce(
    (acc, curr) => acc + curr.count,
    0
  );
  const costsData = analytics.data
    ?.slice(15)
    .map((entry) => ({ date: entry.date, total_cost: entry.total_cost }));
  const costsPreviousPeriod = analytics.data
    ?.slice(0, 15)
    .map((entry) => ({ date: entry.date, total_cost: entry.total_cost }));
  const costsTotal = analytics.data?.reduce(
    (acc, curr) => acc + curr.total_cost,
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
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "#9CA3AF" }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tickCount={4}
          tickMargin={20}
          domain={[0, "dataMax"]}
          tick={{ fill: "#9CA3AF" }}
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
          type="monotone"
          dataKey={dataKey}
          stroke="#ED8926"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 8 }}
          name="Messages"
        />
        <Line
          type="monotone"
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
