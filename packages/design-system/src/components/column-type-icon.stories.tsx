import { HStack, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ColumnTypeIcon } from "./column-type-icon";

const TYPES = [
  "string",
  "number",
  "boolean",
  "json",
  "chat_messages",
  "image",
  "date",
  "list",
  "rag_contexts",
  "spans",
  "annotations",
  "evaluations",
];

const meta = {
  title: "Primitives/Column type icon",
  component: ColumnTypeIcon,
  tags: ["autodocs"],
  args: { type: "string", size: 12 },
} satisfies Meta<typeof ColumnTypeIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every type the design system draws a cue for, side by side. */
export const AllTypes: Story = {
  render: (args) => (
    <Stack gap="2">
      {TYPES.map((type) => (
        <HStack key={type} gap="2">
          <ColumnTypeIcon {...args} type={type} />
          <Text textStyle="sm">{type}</Text>
        </HStack>
      ))}
    </Stack>
  ),
};

/** A type with no mapping falls back to the neutral text icon. */
export const UnknownType: Story = {
  args: { type: "something_new" },
};

export const Sizes: Story = {
  render: (args) => (
    <HStack gap="4" align="center">
      <ColumnTypeIcon {...args} size={12} />
      <ColumnTypeIcon {...args} size={16} />
      <ColumnTypeIcon {...args} size={24} />
    </HStack>
  ),
};
