import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { TimeSeriesChart, type TimeSeriesSeries } from "./time-series-chart.tsx";

const DAYS = [
  "Mon 5 Oct",
  "Tue 6 Oct",
  "Wed 7 Oct",
  "Thu 8 Oct",
  "Fri 9 Oct",
  "Sat 10 Oct",
  "Sun 11 Oct",
];

function series({ name, values }: { name: string; values: number[] }): TimeSeriesSeries {
  return { name, points: values.map((value, at) => ({ label: DAYS[at] ?? "", value })) };
}

const REQUESTS = series({ name: "Requests", values: [1180, 1260, 1420, 1310, 1240, 640, 560] });
const COST = series({ name: "Cost", values: [4.96, 5.41, 6.12, 5.58, 5.29, 2.71, 2.35] });

const meta = {
  title: "Data display/Time series chart",
  component: TimeSeriesChart,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "A trend over days or hours: requests, cost, latency. It reads its values from props and draws its own grid, colours and hover reading.",
      avoid:
        "A comparison of categories, a share of a whole or thousands of points: those need a different chart. A figure with no trend: use Stat tile.",
    },
  },
  decorators: [
    (Story) => (
      <Box
        borderWidth="1px"
        borderColor="border.card"
        borderRadius="md"
        bg="bg.card"
        padding={4}
        maxWidth="48rem"
      >
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof TimeSeriesChart>;

export default meta;
type Story = StoryObj<typeof meta>;

const requests = ({ value }: { value: number }) => `${value.toLocaleString("en-GB")} requests`;
const requestTick = ({ value }: { value: number }) => value.toLocaleString("en-GB");
const dollars = ({ value }: { value: number }) => `$${value.toFixed(2)}`;

/** One series: the line, a soft area under it, and a reading on hover. */
export const Default: Story = {
  args: {
    label: "Requests per day",
    series: [REQUESTS],
    formatValue: requests,
    formatTick: requestTick,
  },
};

/** Money on the axis and in the reading; the unit travels in the formatter. */
export const Cost: Story = {
  args: { label: "Cost per day", series: [COST], formatValue: dollars },
};

/** Several series share the days; a legend names them. */
export const TwoSeries: Story = {
  args: {
    label: "Requests and errors per day",
    series: [REQUESTS, series({ name: "Errors", values: [6, 5, 11, 7, 6, 3, 2] })],
    formatValue: requests,
    formatTick: requestTick,
  },
};

/** One reading draws a dot, not a line. */
export const SingleReading: Story = {
  args: {
    label: "Requests today",
    series: [{ name: "Requests", points: [{ label: "Sun 11 Oct", value: 560 }] }],
    formatValue: requests,
    formatTick: requestTick,
  },
};

/** No points: the chart keeps its box and says so quietly. */
export const NoData: Story = {
  args: {
    label: "Requests per day",
    series: [{ name: "Requests", points: [] }],
    formatValue: requests,
    emptyDescription: "Send a request through your project and it appears here within a minute.",
  },
};
