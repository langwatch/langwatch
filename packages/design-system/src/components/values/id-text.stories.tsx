import { Box, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { IdText } from "./id-text.tsx";

const meta = {
  title: "Data display/Id text",
  parameters: {
    usage: {
      use: "Any identifier a person may copy (trace, span, key, project, org ids): neutral mono, cut in the middle, copy on hover or focus. In a table cell: ListTable.IdCell.",
      avoid:
        '`fontFamily="monospace"` or a hand-sliced id. Event names and keys inside a sentence: Inline code.',
    },
  },
  component: IdText,
  tags: ["autodocs"],
  args: { value: "trace_2Mx9KfQ2mZ7LrP4tVbN8wE", label: "trace ID" },
} satisfies Meta<typeof IdText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box maxWidth="160px">
      <IdText {...args} />
    </Box>
  ),
};

export const WithoutCopy: Story = { args: { copyable: false } };

export const InASentence: Story = {
  render: (args) => (
    <Text textStyle="sm">
      Project <IdText {...args} value="project_kd93jf02kd" label="project ID" /> receives the
      traces.
    </Text>
  ),
};
