import { Box, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { SearchInput } from "./search-input.tsx";

const meta = {
  title: "Inputs and forms/Search input",
  parameters: {
    usage: {
      use: "Filtering a list or table by text. It carries the search icon and the searchbox role.",
      avoid: "Any other text field: use Input from primitives inside a Field.",
    },
  },
  component: SearchInput,
  tags: ["autodocs"],
  args: {
    placeholder: "Search traces",
  },
  render: (args) => (
    <Box maxWidth="sm">
      <SearchInput {...args} />
    </Box>
  ),
} satisfies Meta<typeof SearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = {
  args: { defaultValue: "gpt-5-mini" },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const Sizes: Story = {
  render: (args) => (
    <Stack gap="3" maxWidth="sm">
      <SearchInput {...args} size="xs" />
      <SearchInput {...args} size="sm" />
      <SearchInput {...args} size="md" />
      <SearchInput {...args} size="lg" />
    </Stack>
  ),
};

export const LongText: Story = {
  args: {
    defaultValue:
      "trace.metadata.customer_id = 'acme' AND evaluation.status = 'failed' AND model = 'gpt-5-mini'",
  },
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box maxWidth="140px">
      <SearchInput {...args} />
    </Box>
  ),
};
