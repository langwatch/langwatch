import { useTheme } from "@chakra-ui/react";
import { useGetRotatingColorForCharts } from "../../hooks/useGetRotatingColorForCharts";
import { format } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import numeral from "numeral";

type CurrentVsPreviousNumericalData<T extends string> = {
  currentPeriod: ({ date: string } & Record<T, number>)[];
  previousPeriod: ({ date: string } & Record<T, number>)[];
};

export function CurrentVsPreviousPeriodLineChart<T extends string>({
  valueKey,
  data,
  valueFormat,
}: {
  valueKey: T;
  data: CurrentVsPreviousNumericalData<T> | undefined;
  valueFormat?: string;
}) {
  const getColor = useGetRotatingColorForCharts();
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];

  const formatDate = (date: string) => date && format(new Date(date), "MMM d");
  const valueFormatter = (value: number) =>
    numeral(value).format(valueFormat ?? "0a");

  const currentAndPreviousData = data?.previousPeriod?.map((entry, index) => {
    return {
      ...data.currentPeriod[index],
      previousValue: entry[valueKey],
      previousDate: entry.date,
    };
  });

  return (
    <ResponsiveContainer
      key={currentAndPreviousData ? valueKey : "loading"}
      height={300}
    >
      <LineChart
        data={currentAndPreviousData}
        margin={{ left: (valueFormat ?? "0a").length * 4 - 10 }}
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
          tickFormatter={valueFormatter}
        />
        <Tooltip
          formatter={valueFormatter}
          labelFormatter={(_label, payload) => {
            return (
              formatDate(payload[0]?.payload.date) +
              (payload[1]?.payload.previousDate
                ? " vs " + formatDate(payload[1]?.payload.previousDate)
                : "")
            );
          }}
        />
        <Legend />
        <Line
          type="linear"
          dataKey={valueKey}
          stroke={getColor("colors", 0)}
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
      </LineChart>
    </ResponsiveContainer>
  );
}

type AggregatedNumericalData<T extends string> = Record<
  string,
  ({ date: string } & Record<T, number>)[]
>;

export function AggregatedLineChart<T extends string>({
  valueKey,
  data,
  valueFormat,
}: {
  valueKey: T;
  data: AggregatedNumericalData<T> | undefined;
  valueFormat?: string;
}) {
  const getColor = useGetRotatingColorForCharts();
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];

  const formatDate = (date: string) => date && format(new Date(date), "MMM d");
  const valueFormatter = (value: number) =>
    numeral(value).format(valueFormat ?? "0a");

  const mergedData: Record<string, number | string>[] = [];
  for (const [subkey, agg] of Object.entries(data ?? {})) {
    if (!data) continue;

    for (const [index, entry] of agg.entries()) {
      if (!mergedData[index]) mergedData[index] = { date: entry.date };
      mergedData[index]![subkey] = entry[valueKey];
    }
  }

  return (
    <ResponsiveContainer key={mergedData ? valueKey : "loading"} height={300}>
      <AreaChart
        data={mergedData}
        margin={{ left: (valueFormat ?? "0a").length * 4 - 10 }}
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
          tickFormatter={valueFormatter}
        />
        <Tooltip
          formatter={valueFormatter}
          labelFormatter={(_label, payload) => {
            return formatDate(payload[0]?.payload.date);
          }}
        />
        <Legend />
        {Object.keys(data ?? {}).map((agg, index) => (
          <Area
            key={agg}
            type="linear"
            dataKey={agg}
            stroke={getColor("colors", index)}
            fill={getColor("colors", index)}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 8 }}
            name={agg}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
