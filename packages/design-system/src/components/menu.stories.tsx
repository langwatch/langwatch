import { Button, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MoreVertical } from "lucide-react";
import { Menu } from "./menu.tsx";

const meta = {
  title: "Components/Menu",
  component: Menu.Root,
  tags: ["autodocs"],
  args: { children: null },
  render: (args) => (
    <Menu.Root {...args}>
      <Menu.Trigger asChild>
        <Button size="sm" variant="ghost" aria-label="Row actions">
          <MoreVertical size={16} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="open">Open</Menu.Item>
        <Menu.Item value="duplicate">Duplicate</Menu.Item>
        <Menu.Separator />
        <Menu.Item value="delete" color="fg.error">
          Delete
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  ),
} satisfies Meta<typeof Menu.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  args: { open: true },
};

export const WithGroupsAndDisabledItems: Story = {
  args: { open: true },
  render: (args) => (
    <Menu.Root {...args}>
      <Menu.Trigger asChild>
        <Button size="sm" variant="outline">
          Actions
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.ItemGroup title="This prompt">
          <Menu.Item value="open">Open</Menu.Item>
          <Menu.Item value="duplicate">Duplicate</Menu.Item>
        </Menu.ItemGroup>
        <Menu.Separator />
        <Menu.ItemGroup title="Version">
          <Menu.Item value="restore" disabled>
            Restore (no earlier version)
          </Menu.Item>
        </Menu.ItemGroup>
      </Menu.Content>
    </Menu.Root>
  ),
};

export const WithCheckboxItems: Story = {
  args: { open: true },
  render: (args) => (
    <Menu.Root {...args}>
      <Menu.Trigger asChild>
        <Button size="sm" variant="outline">
          Columns
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.CheckboxItem value="model" checked>
          Model
        </Menu.CheckboxItem>
        <Menu.CheckboxItem value="latency" checked>
          Latency
        </Menu.CheckboxItem>
        <Menu.CheckboxItem value="cost" checked={false}>
          Cost
        </Menu.CheckboxItem>
      </Menu.Content>
    </Menu.Root>
  ),
};

export const LongText: Story = {
  args: { open: true },
  render: (args) => (
    <Stack maxWidth="220px">
      <Menu.Root {...args}>
        <Menu.Trigger asChild>
          <Button size="sm" variant="outline">
            Actions
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item value="export">Export every trace in the current filter as JSON</Menu.Item>
          <Menu.Item value="rerun">Run every failed evaluation again</Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </Stack>
  ),
};
