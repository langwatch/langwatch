import { Button, Link, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tooltip } from "./tooltip";

const meta = {
  title: "Primitives/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  args: {
    content: "Runs the prompt against every row of the dataset.",
    children: <Button size="sm">Evaluate</Button>,
  },
  argTypes: { children: { control: false }, content: { control: "text" } },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hover or focus the trigger. */
export const Default: Story = {};

export const OpenByDefault: Story = {
  args: { open: true },
};

export const WithArrow: Story = {
  args: { showArrow: true, open: true },
};

/** Turned off entirely: the trigger renders alone, with no wrapper. */
export const Disabled: Story = {
  args: { disabled: true },
};

/** An empty content closes it too, so a missing explanation shows nothing. */
export const NoContent: Story = {
  args: { content: "" },
};

/** Interactive tooltips wait for the pointer to cross the gap, so links stay reachable. */
export const Interactive: Story = {
  args: {
    interactive: true,
    open: true,
    content: (
      <Text>
        Spend is billed per million tokens. <Link href="https://langwatch.ai/docs">Read more</Link>
      </Text>
    ),
  },
};

export const LongText: Story = {
  args: {
    open: true,
    content:
      "Evaluations run against the dataset snapshot taken when the run started, so editing the dataset afterwards never changes a finished result.",
  },
  render: (args) => (
    <Stack maxWidth="200px">
      <Tooltip {...args} />
    </Stack>
  ),
};
