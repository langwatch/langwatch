import { Box, Button, HStack, Spinner, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Database } from "lucide-react";

import { NoDataInfoBlock } from "../states/no-data-info-block.tsx";
import { SkeletonRows } from "../states/skeletons.tsx";
import { Drawer } from "./drawer.tsx";

const meta = {
  title: "Overlays/Drawer",
  parameters: {
    usage: {
      use: "Details, editing a record and multi-step forms beside the page. Drawers are routed singletons. End a form with Drawer.Actions: Cancel (outline) then one orange primary, a Delete on the left via `start`. Fields inside stack on their own (Settings field).",
      avoid:
        "A quick yes or no: use Dialog. Never a drawer inside a drawer: navigate instead. Never `bg`, `background` or `borderRadius` on Drawer.Content, nor fontSize or fontWeight on Drawer.Title: the recipe owns them. A Spinner as the body while loading: use Skeleton rows.",
    },
  },
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
        <Drawer.Actions primary={<Button colorPalette="orange">Save</Button>} />
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
          <SkeletonRows rows={6} />
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

/** The standard footer with a destructive secondary on the left edge. */
export const ActionsWithStart: Story = {
  render: (args) => (
    <Drawer.Root {...args}>
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Drawer.Title>Edit model provider</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <Text textStyle="sm">OpenAI · 4 models enabled</Text>
        </Drawer.Body>
        <Drawer.Actions
          start={
            <Button variant="ghost" colorPalette="red">
              Remove provider
            </Button>
          }
          primary={<Button colorPalette="orange">Save</Button>}
        />
      </Drawer.Content>
    </Drawer.Root>
  ),
};

/** The width steps this product adds on top of Chakra's own. */
export const Sizes: Story = {
  args: { size: "2xl" },
};

/** Inline panels make header, body and footer states comparable in both modes. */
export const StatesSideBySide: Story = {
  render: () => (
    <Stack gap={6}>
      {(["light", "dark"] as const).map((mode) => (
        <HStack
          key={mode}
          className={mode}
          bg="bg.panel"
          color="fg"
          align="start"
          gap={4}
          padding={4}
          wrap="wrap"
        >
          {(["Ready", "Loading", "Empty", "Error", "Long content"] as const).map((state) => (
            <Box
              key={state}
              width="360px"
              height="360px"
              position="relative"
              css={{
                "& [data-part=positioner]": { position: "absolute", inset: 0 },
                "& [data-part=content]": {
                  width: "full",
                  maxWidth: "full",
                  height: "calc(100% - 16px)",
                },
              }}
            >
              <Drawer.Root open size="md" trapFocus={false}>
                <Drawer.Content portalled={false}>
                  <Drawer.CloseTrigger />
                  <Drawer.Header>
                    <Drawer.Title>
                      {state === "Long content"
                        ? "Organization notification preferences"
                        : "Connection details"}
                    </Drawer.Title>
                    <Drawer.Description>
                      {mode} · {state}
                    </Drawer.Description>
                  </Drawer.Header>
                  <Drawer.Body>
                    <DrawerStoryBody state={state} />
                  </Drawer.Body>
                  <Drawer.Footer>
                    <Button variant="outline" size="sm">
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={state === "Empty" || state === "Error"}
                      loading={state === "Loading"}
                    >
                      Save
                    </Button>
                  </Drawer.Footer>
                </Drawer.Content>
              </Drawer.Root>
            </Box>
          ))}
        </HStack>
      ))}
    </Stack>
  ),
};

function DrawerStoryBody({ state }: { state: string }) {
  if (state === "Loading") return <Spinner aria-label="Loading connection" />;
  if (state === "Empty") return <Text color="fg.muted">No connections yet.</Text>;
  if (state === "Error")
    return (
      <Text role="alert" color="red.fg">
        Couldn't load the connection. Try again.
      </Text>
    );
  return (
    <Stack gap={4}>
      {Array.from({ length: state === "Long content" ? 12 : 1 }, (_, index) => (
        <Text key={index}>Choose where this connection can send notifications.</Text>
      ))}
    </Stack>
  );
}
