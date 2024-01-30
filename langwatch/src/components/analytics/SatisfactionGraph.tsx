import {
  Card,
  CardBody,
  HStack,
  Link,
  Tab,
  TabIndicator,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  useTheme,
} from "@chakra-ui/react";
import numeral from "numeral";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer } from "recharts";
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import { api } from "../../utils/api";
import { MetricChange } from "./SummaryMetric";

export const SatisfactionPieChart = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const { data } = api.analytics.satisfactionVsPreviousPeriod.useQuery(
    analyticsParams,
    queryOpts
  );
  const { data: thumbsUpDownRawData } =
    api.analytics.thumbsUpDownVsPreviousPeriod.useQuery(
      analyticsParams,
      queryOpts
    );
  const thumbsUpDownData = thumbsUpDownRawData && {
    currentPeriod: thumbsUpDownRawData.currentPeriod.map((entry) => ({
      date: entry.date,
      positive: entry.metrics.positive.doc_count,
      negative: entry.metrics.negative.doc_count,
    })),
    previousPeriod: thumbsUpDownRawData.currentPeriod.map((entry) => ({
      date: entry.date,
      positive: entry.metrics.positive.doc_count,
      negative: entry.metrics.negative.doc_count,
    })),
  };

  const { positiveNeutralRatio, positiveNeutralRatioPrevious } =
    getCounts(data);

  const {
    positiveNeutralRatio: positiveRatioThumbsUpDown,
    positiveNeutralRatioPrevious: previousPositiveRatioThumbsUpDown,
    total: totalThumbsUpDown,
    totalPrevious: totalPreviousThumbsUpDown,
  } = getCounts(thumbsUpDownData);

  return (
    <Card width="full" height="335px">
      <CardBody padding={0}>
        <Tabs variant="unstyled">
          <TabList gap={0}>
            <Tab width="50%" fontSize={14} paddingX={2} paddingY={4}>
              <HStack flexWrap="nowrap">
                <Text noOfLines={1}>Input Sentiment</Text>
                {data && positiveNeutralRatioPrevious > 0 && (
                  <MetricChange
                    current={positiveNeutralRatio}
                    previous={positiveNeutralRatioPrevious}
                  />
                )}
              </HStack>
            </Tab>
            <Tab width="50%" fontSize={14} paddingX={2} paddingY={4}>
              <HStack flexWrap="nowrap">
                <Text noOfLines={1}>Thumbs Up/Down</Text>
                {data && previousPositiveRatioThumbsUpDown > 0 && (
                  <MetricChange
                    current={positiveRatioThumbsUpDown}
                    previous={previousPositiveRatioThumbsUpDown}
                  />
                )}
              </HStack>
            </Tab>
          </TabList>
          <TabIndicator height="4px" bg="orange.400" borderRadius="1px" />
          <TabPanels>
            <TabPanel padding={0}>
              <SatisfactionPieChartChart data={data} />
            </TabPanel>
            <TabPanel padding={0}>
              {thumbsUpDownData && totalThumbsUpDown == 0 && totalPreviousThumbsUpDown == 0 ? (
                <Text padding={6} fontSize={14}>
                  No events for thumbs up/down were captured in the selected
                  period. Check our{" "}
                  <Link
                    href="https://docs.langwatch.ai/docs/user-events/thumbs-up-down"
                    target="_blank"
                    color="orange.400"
                  >
                    documentation
                  </Link>{" "}
                  on how to set it up.
                </Text>
              ) : (
                <SatisfactionPieChartChart
                  data={thumbsUpDownData}
                  useNeutral={false}
                />
              )}
            </TabPanel>
          </TabPanels>
        </Tabs>
      </CardBody>
    </Card>
  );
};

const getCounts = (
  data:
    | {
        currentPeriod: {
          positive: number;
          negative: number;
          neutral?: number;
        }[];
        previousPeriod: {
          positive: number;
          negative: number;
          neutral?: number;
        }[];
      }
    | undefined
) => {
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  for (const entry of data?.currentPeriod ?? []) {
    positive += entry.positive;
    negative += entry.negative;
    neutral += entry.neutral ?? 0;
  }
  const total = positive + negative + neutral;
  const positiveNeutralRatio = (positive + neutral) / total;

  let positiveNeutralPrevious = 0;
  let totalPrevious = 0;
  for (const entry of data?.previousPeriod ?? []) {
    positiveNeutralPrevious += entry.positive + (entry.neutral ?? 0);
    totalPrevious += entry.positive + entry.negative + (entry.neutral ?? 0);
  }
  const positiveNeutralRatioPrevious = positiveNeutralPrevious / totalPrevious;

  return {
    positive,
    negative,
    neutral,
    total,
    totalPrevious,
    positiveNeutralRatio,
    positiveNeutralRatioPrevious,
  };
};

const SatisfactionPieChartChart = ({
  data,
  useNeutral = true,
}: {
  data:
    | {
        currentPeriod: {
          positive: number;
          negative: number;
          neutral?: number;
        }[];
        previousPeriod: {
          positive: number;
          negative: number;
          neutral?: number;
        }[];
      }
    | undefined;
  useNeutral?: boolean;
}) => {
  const theme = useTheme();
  const gray = theme.colors.gray["300"];
  const green = theme.colors.green["400"];
  const red = theme.colors.red["400"];
  const COLORS = [green, red, gray];

  const { positive, negative, neutral, positiveNeutralRatio } = getCounts(data);

  if (!data) {
    return (
      <ResponsiveContainer key="satisfaction" width="100%" height={280}>
        <div />
      </ResponsiveContainer>
    );
  }

  const chartData = [
    { name: "Positive", value: positive },
    { name: "Negative", value: negative },
    ...(useNeutral ? [{ name: "Neutral", value: neutral }] : []),
  ];

  const RADIAN = Math.PI / 180;
  const renderCustomizedLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
    name,
  }: {
    cx: number;
    cy: number;
    midAngle: number;
    innerRadius: number;
    outerRadius: number;
    percent: number;
    name: string;
  }) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (percent < 0.01) return null;

    return (
      <text
        x={x}
        y={y}
        fill={name === "Neutral" ? "#999" : "white"}
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fontSize: "13px" }}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const renderLegendText = (value: any, entry: any) => {
    const { color, payload } = entry;
    const newColor = payload.name === "Neutral" ? "#666" : color;
    return <span style={{ color: newColor, fontSize: "15px" }}>{value}</span>;
  };

  const goodRatioThreshold = useNeutral ? 0.9 : 0.5;

  return (
    <ResponsiveContainer key="satisfaction" width="100%" height={280}>
      <PieChart>
        <Pie
          data={chartData}
          labelLine={false}
          label={renderCustomizedLabel}
          fill="#8884d8"
          dataKey="value"
          innerRadius={60}
        >
          {chartData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Legend formatter={renderLegendText} />
        <text
          x="50%"
          y="43%"
          fill={positiveNeutralRatio > goodRatioThreshold ? green : red}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: "28px", fontWeight: 600 }}
        >
          {numeral(positiveNeutralRatio).format("0%")}
        </text>
        <text
          x="50%"
          y="52%"
          fill={positiveNeutralRatio > goodRatioThreshold ? green : red}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: "13px", fontWeight: 600 }}
        >
          {useNeutral ? "Pos + Neutral" : "Positive"}
        </text>
      </PieChart>
    </ResponsiveContainer>
  );
};
