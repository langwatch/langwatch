import { Button, Input, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Popover } from "./popover.tsx";

const meta = {
  title: "Components/Popover",
  component: Popover.Root,
  tags: ["autodocs"],
  args: { children: null },
  render: (args) => (
    <Popover.Root {...args}>
      <Popover.Trigger asChild>
        <Button size="sm" variant="outline">
          Filters
        </Button>
      </Popover.Trigger>
      <Popover.Content width="260px">
        <Popover.Arrow />
        <Popover.CloseTrigger />
        <Popover.Header>
          <Popover.Title fontWeight="semibold">Filter traces</Popover.Title>
        </Popover.Header>
        <Popover.Body>
          <Stack gap="2">
            <Text textStyle="sm" color="fg.muted">
              Only traces matching every field are shown.
            </Text>
            <Input size="sm" placeholder="Model" />
          </Stack>
        </Popover.Body>
        <Popover.Footer>
          <Button size="xs" variant="ghost">
            Clear
          </Button>
        </Popover.Footer>
      </Popover.Content>
    </Popover.Root>
  ),
} satisfies Meta<typeof Popover.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  args: { open: true },
};

/** Nothing to filter on yet. */
export const Empty: Story = {
  args: { open: true },
  render: (args) => (
    <Popover.Root {...args}>
      <Popover.Trigger asChild>
        <Button size="sm" variant="outline">
          Filters
        </Button>
      </Popover.Trigger>
      <Popover.Content width="260px">
        <Popover.Arrow />
        <Popover.Body>
          <Text textStyle="sm" color="fg.muted">
            This project has no traces yet, so there is nothing to filter.
          </Text>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <Popover.Root {...args}>
      <Popover.Trigger asChild>
        <Button size="sm" variant="outline" disabled>
          Filters
        </Button>
      </Popover.Trigger>
      <Popover.Content>
        <Popover.Body>Unreachable while the trigger is disabled.</Popover.Body>
      </Popover.Content>
    </Popover.Root>
  ),
};
