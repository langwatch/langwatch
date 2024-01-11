import {
  Card,
  CardBody,
  CardHeader,
  HStack,
  Heading,
  useTheme,
} from "@chakra-ui/react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Text,
  XAxis,
} from "recharts";
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import { api } from "../../utils/api";
import numeral from "numeral";
import { MetricChange } from "./SummaryMetric";

export const SatisfactionPieChart = () => {
  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const { data } = api.analytics.satisfactionVsPreviousPeriod.useQuery(
    analyticsParams,
    queryOpts
  );

  const { positiveNeutralRatio, positiveNeutralRatioPrevious } = getCounts(data);

  return (
    <Card width="full" height="335px">
      <CardHeader>
        <HStack>
          <Heading size="sm">User Satisfaction</Heading>
          {data && positiveNeutralRatioPrevious > 0 && (
            <MetricChange
              current={positiveNeutralRatio}
              previous={positiveNeutralRatioPrevious}
            />
          )}
        </HStack>
      </CardHeader>
      <CardBody padding={0} marginTop="-24px">
        <SatisfactionPieChartChart data={data} />
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
          neutral: number;
        }[];
        previousPeriod: {
          positive: number;
          negative: number;
          neutral: number;
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
    neutral += entry.neutral;
  }
  const total = positive + negative + neutral;
  const positiveNeutralRatio = (positive + neutral) / total;

  let positiveNeutralPrevious = 0;
  let totalPrevious = 0;
  for (const entry of data?.previousPeriod ?? []) {
    positiveNeutralPrevious += entry.positive + entry.neutral;
    totalPrevious += entry.positive + entry.negative + entry.neutral;
  }
  const positiveNeutralRatioPrevious = positiveNeutralPrevious / totalPrevious;

  return {
    positive,
    negative,
    neutral,
    positiveNeutralRatio,
    positiveNeutralRatioPrevious,
  };
};

const SatisfactionPieChartChart = ({
  data,
}: {
  data:
    | {
        currentPeriod: {
          positive: number;
          negative: number;
          neutral: number;
        }[];
        previousPeriod: {
          positive: number;
          negative: number;
          neutral: number;
        }[];
      }
    | undefined;
}) => {
  const theme = useTheme();
  const gray = theme.colors.gray["300"];
  const green = theme.colors.green["400"];
  const red = theme.colors.red["400"];
  const COLORS = [green, red, gray];

  const { positive, negative, neutral, positiveNeutralRatio } = getCounts(data);

  if (!data) {
    return (
      <ResponsiveContainer key="satisfaction" width="100%" height={300}>
        <div />
      </ResponsiveContainer>
    );
  }

  const chartData = [
    { name: "Positive", value: positive },
    { name: "Negative", value: negative },
    { name: "Neutral", value: neutral },
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

  return (
    <ResponsiveContainer key="satisfaction" width="100%" height={300}>
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
          fill={positiveNeutralRatio > 0.9 ? green : red}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: "28px", fontWeight: 600 }}
        >
          {numeral(positiveNeutralRatio).format("0%")}
        </text>
        <text
          x="50%"
          y="52%"
          fill={positiveNeutralRatio > 0.9 ? green : red}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: "13px", fontWeight: 600 }}
        >
          Pos + Neutral
        </text>
      </PieChart>
    </ResponsiveContainer>
  );
};
