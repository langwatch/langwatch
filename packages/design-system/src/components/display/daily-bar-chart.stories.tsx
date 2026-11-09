import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DailyBarChart } from "./daily-bar-chart.tsx";

const COUNTS = [
  1200, 1850, 2400, 900, 0, 0, 3100, 2800, 2650, 3900, 4100, 400, 0, 2900, 3300, 3600, 4800, 4200,
  600, 0, 3100, 3500, 2700, 3000, 3800, 500, 0, 2200, 2600, 3100,
];

const bars = (counts: readonly number[]) =>
  counts.map((value, index) => ({
    value,
    title: `${index + 1} Nov: ${value.toLocaleString("en-GB")} events`,
  }));

const meta = {
  title: "Data display/Daily bar chart",
  component: DailyBarChart,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "A count per day over a short period, such as events per day this month, where each day is its own bar.",
      avoid:
        "A trend you read as a line, several series or a value with a y axis: use Time series chart.",
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
} satisfies Meta<typeof DailyBarChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A month of days: weekends are quiet, a small day keeps a sliver. */
export const Month: Story = {
  args: {
    bars: bars(COUNTS),
    axis: ["1 Nov", "15 Nov", "30 Nov"],
    summary: "Events per day this month, from 1 Nov.",
  },
};

/** The first days of a month, before most days have a count. */
export const EarlyMonth: Story = {
  args: {
    bars: bars([800, 2100, 0, 1500]),
    axis: ["1 Nov", "4 Nov"],
    summary: "Events per day this month, from 1 Nov.",
  },
};
