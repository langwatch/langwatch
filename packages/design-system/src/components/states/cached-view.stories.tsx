import { Box, Text } from "@chakra-ui/react";
import { Temporal } from "@langwatch/time";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { CachedView } from "./cached-view.tsx";

const meta = {
  title: "Components/Cached view",
  component: CachedView,
  tags: ["autodocs"],
  args: {
    asOf: Temporal.Now.instant().subtract({ minutes: 14 }),
    confirmed: false,
    children: (
      <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding="6">
        <Text fontSize="2xl" fontWeight="600">
          1,284 traces
        </Text>
      </Box>
    ),
  },
  argTypes: {
    children: { control: false },
  },
  decorators: [
    (Story) => (
      <Box width="320px" height="120px">
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof CachedView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Saved data, dimmed, saying when it is from while the network is asked. */
export const Updating: Story = {};

/** The network has answered: full strength, no pill. */
export const Confirmed: Story = {
  args: { confirmed: true },
};

/** The refresh finished without an answer: the pill stops spinning and says so. */
export const CouldNotRefresh: Story = {
  args: { failed: true },
};

/** A copy from an earlier day names the day as well as the time. */
export const FromAnEarlierDay: Story = {
  args: { asOf: Temporal.Now.instant().subtract({ hours: 49 }) },
};

export const TimeNotKnown: Story = {
  args: { asOf: null },
};
