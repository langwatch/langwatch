import { Button, Spinner, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Drawer } from "./studio-drawer.tsx";

function Crashing(): never {
  throw new Error("readNodeParameters is not a function");
}

const meta = {
  title: "Patterns/Studio drawer",
  component: Drawer.Root,
  tags: ["autodocs"],
  args: { open: true, size: "md", children: null },
  argTypes: {
    size: { control: "select", options: ["xs", "sm", "md", "lg", "xl", "2xl", "full"] },
  },
  render: (args) => (
    <Drawer.Root {...args}>
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Drawer.Title>Node inspector</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <Stack gap="2">
            <Text textStyle="sm" color="fg.muted">
              The canvas behind stays interactive while this drawer is open.
            </Text>
          </Stack>
        </Drawer.Body>
        <Drawer.Footer>
          <Button size="sm">Apply</Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  ),
} satisfies Meta<typeof Drawer.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Closed: Story = {
  args: { open: false },
};

export const Loading: Story = {
  render: (args) => (
    <Drawer.Root {...args}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Node inspector</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <Stack align="center" paddingY="8">
            <Spinner />
          </Stack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  ),
};

/** A crash in the body shows an inline panel instead of closing the drawer. */
export const BodyCrashed: Story = {
  render: (args) => (
    <Drawer.Root {...args}>
      <Drawer.Content errorScope="Node inspector">
        <Drawer.Header>
          <Drawer.Title>Node inspector</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <Crashing />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  ),
};
