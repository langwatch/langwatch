import { Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { PropertySectionTitle } from "./property-section-title.tsx";

const meta = {
  title: "Inputs and forms/Property section title",
  parameters: {
    usage: {
      use: "The heading of a section inside a properties panel, as in the studio and the prompt editor.",
      avoid: "A settings page band: use Settings section.",
    },
  },
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
