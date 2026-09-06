import { Button, Spinner, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Drawer } from "./drawer";
import { NoDataInfoBlock } from "./no-data-info-block";
import { Database } from "lucide-react";

const meta = {
  title: "Components/Drawer",
  component: Drawer.Root,
  tags: ["autodocs"],
  args: { open: true, size: "md", children: null },
  argTypes: {
    size: { control: "select", options: ["xs", "sm", "md", "lg", "xl", "2xl", "full"] },
  },
  render: (args) => (
    <Drawer.Root {...args}>
      <Drawer.Trigger asChild>
        <Button size="sm">Open trace</Button>
      </Drawer.Trigger>
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Drawer.Title>Trace details</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <Stack gap="2">
            <Text textStyle="sm" color="fg.muted">
              gpt-5-mini · 1.4 seconds · 3,204 tokens
            </Text>
            <Text>The customer asked how to rotate a virtual key.</Text>
          </Stack>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="ghost" size="sm">
            Close
          </Button>
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
          <Drawer.Title>Trace details</Drawer.Title>
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

export const Empty: Story = {
  render: (args) => (
    <Drawer.Root {...args}>
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Drawer.Title>Datasets</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <NoDataInfoBlock
            title="No datasets yet"
            description="Datasets hold the examples you evaluate a prompt against."
            icon={<Database />}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  ),
};

/** The width steps this product adds on top of Chakra's own. */
export const Sizes: Story = {
  args: { size: "2xl" },
};
