import { Box, Spinner, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Delayed } from "./delayed.tsx";

const meta = {
  title: "Primitives/Delayed",
  component: Delayed,
  tags: ["autodocs"],
  args: {
    delay: 100,
    children: <Text>Shown once the delay has passed.</Text>,
  },
  argTypes: {
    children: { control: false },
  },
} satisfies Meta<typeof Delayed>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing paints for the first 100ms, so a fast answer never flashes a spinner. */
export const Default: Story = {};

export const LongDelay: Story = {
  args: { delay: 2000 },
};

/** Reserves the space it will take, so the layout does not jump when it appears. */
export const TakingSpace: Story = {
  args: {
    takeSpace: true,
    delay: 1500,
    children: <Spinner size="sm" />,
  },
  render: (args) => (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding="3" width="120px">
      <Delayed {...args} />
    </Box>
  ),
};
