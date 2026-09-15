import { Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SmallLabel } from "./small-label.tsx";

const meta = {
  title: "Primitives/Small label",
  component: SmallLabel,
  tags: ["autodocs"],
  args: {
    children: "Model",
  },
} satisfies Meta<typeof SmallLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongText: Story = {
  args: {
    children: "Evaluation criteria for the retrieval augmented generation pipeline",
  },
  render: (args) => (
    <Stack maxWidth="200px">
      <SmallLabel {...args} />
    </Stack>
  ),
};

export const NarrowWidth: Story = {
  args: { children: "Total spend this period" },
  render: (args) => (
    <Stack maxWidth="90px">
      <SmallLabel {...args} />
    </Stack>
  ),
};
