import { Button, Link, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { EmptyOptionsHint, OptionItem } from "./option-list.tsx";

const meta = {
  title: "Inputs and forms/Option list",
  component: EmptyOptionsHint,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "Disable a picker with no loaded options and explain the next action inline.",
      avoid: "Searches with no matches, loading requests, or options that allow free text.",
    },
  },
  args: {
    children: "No score types yet. Create one to use in this queue.",
    action: <Link href="#annotation-scores">Create an annotation score</Link>,
  },
  render: (args) => (
    <Stack maxWidth="sm">
      <Button disabled aria-describedby="empty-score-options">
        Add Score Type
      </Button>
      <EmptyOptionsHint {...args} id="empty-score-options" />
    </Stack>
  ),
} satisfies Meta<typeof EmptyOptionsHint>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <Stack width="220px">
        <Story />
      </Stack>
    ),
  ],
};
export const Options: Story = {
  render: () => (
    <Stack padding={1} gap={0} background="bg.overlay" width="280px">
      <OptionItem type="button">First participant</OptionItem>
      <OptionItem type="button" aria-pressed>
        Selected participant
      </OptionItem>
      <OptionItem type="button" disabled>
        Unavailable participant
      </OptionItem>
    </Stack>
  ),
};
