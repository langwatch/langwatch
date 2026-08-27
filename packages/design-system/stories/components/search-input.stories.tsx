import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchInput } from "../../src/components/search-input";

const meta = {
  title: "Components/Search input",
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

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};
