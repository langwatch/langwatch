import {
  Box,
  Card,
  CardBody,
  CardHeader,
  Center,
  HStack,
  Heading,
  Skeleton,
  useTheme,
} from "@chakra-ui/react";
import { Cell, Pie, PieChart, ResponsiveContainer, Text } from "recharts";
import { Legend } from "recharts";
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import { api } from "../../utils/api";

export const SatisfactionPieChart = () => {
  return (
    <Card width="full" height="335px">
      <CardHeader>
        <HStack>
          <Heading size="sm">User Satisfaction</Heading>
        </HStack>
      </CardHeader>
      <CardBody padding={0} marginTop="-24px">
        <SatisfactionPieChartChart />
      </CardBody>
    </Card>
  );
};

const SatisfactionPieChartChart = () => {
  const theme = useTheme();
  const gray = theme.colors.gray["300"];
  const green = theme.colors.green["400"];
  const red = theme.colors.red["400"];
  const COLORS = [green, red, gray];

  const { analyticsParams, queryOpts } = useAnalyticsParams();
  const { data } = api.analytics.satisfactionVsPreviousPeriod.useQuery(
    analyticsParams,
    queryOpts
  );

  if (!data) {
    return (
      <ResponsiveContainer key="satisfaction" width="100%" height={300}>
        <div />
      </ResponsiveContainer>
    );
  }

  let positive = 0;
  let negative = 0;
  let neutral = 0;
  for (const entry of data.currentPeriod) {
    positive += entry.positive;
    negative += entry.negative;
    neutral += entry.neutral;
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
        <Text
          x={200}
          y={200}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: "13px" }}
        >
          {positive}
        </Text>
      </PieChart>
    </ResponsiveContainer>
  );
};
