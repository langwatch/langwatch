import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ChartEmptyState } from "./chart-empty-state.tsx";

const meta = {
  title: "Feedback/Chart empty state",
  parameters: {
    usage: {
      use: "A chart, graph or stat panel with nothing to plot: it fills the chart's box and centres one quiet line, so a dashboard keeps its grid.",
      avoid:
        "A whole page or list with nothing yet: use Empty state. A call to action inside a chart.",
    },
  },
  component: ChartEmptyState,
  tags: ["autodocs"],
  render: (args) => (
    <Box height="240px" borderWidth="1px" borderColor="border.card" borderRadius="md" bg="bg.card">
      <ChartEmptyState {...args} />
    </Box>
  ),
} satisfies Meta<typeof ChartEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithDescription: Story = {
  args: { description: "Try a longer time range or clear the model filter." },
};

export const FixedHeight: Story = {
  args: { height: "160px" },
  render: (args) => <ChartEmptyState {...args} />,
};
