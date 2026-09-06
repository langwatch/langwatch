import { HStack, Stack, Textarea } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AddMessageButton, MessageRoleLabel, RemoveMessageButton } from "./index.ts";

const meta = {
  title: "Components/Messages",
  component: MessageRoleLabel,
  tags: ["autodocs"],
  args: { role: "user" },
  argTypes: {
    role: { control: "inline-radio", options: ["system", "user", "assistant"] },
  },
} satisfies Meta<typeof MessageRoleLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RoleLabel: Story = {};

export const AllRoles: Story = {
  render: () => (
    <HStack gap="2">
      <MessageRoleLabel role="system" />
      <MessageRoleLabel role="user" />
      <MessageRoleLabel role="assistant" />
    </HStack>
  ),
};

/** The row as a prompt editor composes it. */
export const MessageRow: Story = {
  render: (args) => (
    <Stack gap="2" maxWidth="420px">
      <HStack justify="space-between">
        <MessageRoleLabel {...args} />
        <RemoveMessageButton onRemove={() => undefined} />
      </HStack>
      <Textarea defaultValue="Summarize the retrieved context in two sentences." rows={3} />
      <HStack>
        <AddMessageButton onAdd={() => undefined} />
      </HStack>
    </Stack>
  ),
};

/** Nothing may be added or removed while the run is in flight. */
export const Disabled: Story = {
  render: () => (
    <HStack gap="2">
      <AddMessageButton onAdd={() => undefined} disabled />
      <RemoveMessageButton onRemove={() => undefined} disabled />
    </HStack>
  ),
};
