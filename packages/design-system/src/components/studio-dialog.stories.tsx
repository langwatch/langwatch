import { Button, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dialog } from "./studio-dialog.tsx";

/** Renders during a story so the boundary catches it, as it would in the studio. */
function Crashing(): never {
  throw new Error("readNodeParameters is not a function");
}

const meta = {
  title: "Patterns/Studio dialog",
  component: Dialog.Root,
  tags: ["autodocs"],
  args: { open: true, children: null },
  render: (args) => (
    <Dialog.Root {...args}>
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Node settings</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap="2">
            <Text textStyle="sm" color="fg.muted">
              The studio keeps the page behind reachable, so this dialog neither traps focus nor
              locks scrolling.
            </Text>
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button size="sm">Save</Button>
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

/** A crash in the body shows an inline panel instead of closing the dialog. */
export const BodyCrashed: Story = {
  render: (args) => (
    <Dialog.Root {...args}>
      <Dialog.Content bg="bg" errorScope="Node settings">
        <Dialog.Header>
          <Dialog.Title>Node settings</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Crashing />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  ),
};

/** In a development build the raw message is shown under the heading. */
export const BodyCrashedInDevelopment: Story = {
  render: (args) => (
    <Dialog.Root {...args}>
      <Dialog.Content bg="bg" errorScope="Node settings" isDevelopment>
        <Dialog.Header>
          <Dialog.Title>Node settings</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Crashing />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  ),
};
