import { Box, Input, Kbd, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Search } from "lucide-react";
import { InputGroup } from "./input-group";

const meta = {
  title: "Primitives/Input group",
  component: InputGroup,
  tags: ["autodocs"],
  args: {
    startElement: <Search size={14} aria-hidden="true" />,
    children: <Input placeholder="Find a prompt" />,
  },
  argTypes: {
    startElement: { control: false },
    endElement: { control: false },
    children: { control: false },
  },
  render: (args) => (
    <Box maxWidth="sm">
      <InputGroup {...args} />
    </Box>
  ),
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithEndElement: Story = {
  args: {
    endElement: <Kbd>/</Kbd>,
  },
};

export const BothEnds: Story = {
  args: {
    endElement: (
      <Text textStyle="xs" color="fg.muted">
        USD
      </Text>
    ),
    children: <Input placeholder="0.00" />,
  },
};

export const Disabled: Story = {
  args: { children: <Input placeholder="Find a prompt" disabled /> },
};

export const Invalid: Story = {
  args: { children: <Input defaultValue="not an email" aria-invalid="true" /> },
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Stack maxWidth="160px">
      <InputGroup {...args} />
    </Stack>
  ),
};
