import { Button, Input, Spinner, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dialog } from "./dialog";

const meta = {
  title: "Components/Dialog",
  component: Dialog.Root,
  tags: ["autodocs"],
  args: { open: true, children: null },
  argTypes: {
    size: { control: "select", options: ["xs", "sm", "md", "lg", "xl", "cover", "full"] },
  },
  render: (args) => (
    <Dialog.Root {...args}>
      <Dialog.Trigger asChild>
        <Button size="sm">New project</Button>
      </Dialog.Trigger>
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>New project</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap="3">
            <Text textStyle="sm" color="fg.muted">
              A project holds its own traces, prompts and evaluations.
            </Text>
            <Input placeholder="Project name" />
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost">Cancel</Button>
          <Button>Create</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  ),
} satisfies Meta<typeof Dialog.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Closed: Story = {
  args: { open: false },
};

export const Loading: Story = {
  render: (args) => (
    <Dialog.Root {...args}>
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>Creating the project</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Stack align="center" paddingY="6">
            <Spinner />
          </Stack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  ),
};

export const WithoutBackdrop: Story = {
  render: (args) => (
    <Dialog.Root {...args}>
      <Dialog.Content bg="bg" backdrop={false}>
        <Dialog.Header>
          <Dialog.Title>No backdrop</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>The page behind stays fully visible.</Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  ),
};

export const LongText: Story = {
  render: (args) => (
    <Dialog.Root {...args}>
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>
            Move every prompt in this project to another organization workspace
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Text>
            Moving a project takes its traces, prompts, datasets and evaluations with it. Members
            who are not in the destination organization lose access the moment the move finishes,
            and any software development kit key scoped to this project keeps working.
          </Text>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost">Cancel</Button>
          <Button>Move</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  ),
};
