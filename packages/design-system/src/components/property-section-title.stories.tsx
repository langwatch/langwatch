import { Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PropertySectionTitle } from "./property-section-title";

const meta = {
  title: "Primitives/Property section title",
  component: PropertySectionTitle,
  tags: ["autodocs"],
  args: {
    children: "Inputs",
  },
} satisfies Meta<typeof PropertySectionTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithTooltip: Story = {
  args: {
    children: "Parameters",
    tooltip: "Values the caller sends with every request to this prompt.",
  },
};

export const LongText: Story = {
  args: { children: "Retrieval augmented generation contexts" },
  render: (args) => (
    <Stack maxWidth="180px">
      <PropertySectionTitle {...args} />
    </Stack>
  ),
};
