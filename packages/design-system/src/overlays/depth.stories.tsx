import { Button, Code, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dialog } from "../components/dialog.tsx";
import { Menu } from "../components/menu.tsx";
import { Popover } from "../components/popover.tsx";
import { Tooltip } from "../components/tooltip.tsx";
import { BASE_OVERLAY_Z_INDEX, useOverlayZIndex, Z_INDEX_DEPTH_INCREMENT } from "./depth.ts";

/** Reads the depth it is mounted at, so the nesting is visible rather than inferred. */
function DepthReadout() {
  const { zIndex, depth } = useOverlayZIndex();
  return (
    <Text textStyle="xs" color="fg.muted">
      depth {depth}, z-index <Code>{zIndex}</Code>
    </Text>
  );
}

const meta = {
  title: "Foundations/Overlay depth",
  component: DepthReadout,
  tags: ["autodocs"],
} satisfies Meta<typeof DepthReadout>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Every portalled overlay stacks above the one that opened it. The base sits
 * above Chakra's modal layer, and each level adds one increment.
 */
export const Default: Story = {
  render: () => (
    <Stack gap="1">
      <DepthReadout />
      <Text textStyle="xs" color="fg.muted">
        base {BASE_OVERLAY_Z_INDEX}, increment {Z_INDEX_DEPTH_INCREMENT}
      </Text>
    </Stack>
  ),
};

/** A menu inside a popover inside a dialog: three levels, three z-indexes. */
export const NestedOverlays: Story = {
  render: () => (
    <Dialog.Root open>
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Run parameters</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap="3" align="start">
            <Popover.Root open>
              <Popover.Trigger asChild>
                <Button size="sm" variant="outline">
                  Advanced
                </Button>
              </Popover.Trigger>
              <Popover.Content width="240px">
                <Popover.Body>
                  <Stack gap="2" align="start">
                    <DepthReadout />
                    <Menu.Root open>
                      <Menu.Trigger asChild>
                        <Button size="xs" variant="outline">
                          Model
                        </Button>
                      </Menu.Trigger>
                      <Menu.Content>
                        <Menu.Item value="mini">gpt-5-mini</Menu.Item>
                        <Menu.Item value="opus">claude-opus-4</Menu.Item>
                      </Menu.Content>
                    </Menu.Root>
                  </Stack>
                </Popover.Body>
              </Popover.Content>
            </Popover.Root>
          </Stack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  ),
};

/** A tooltip opened from inside a dialog still paints above it. */
export const TooltipInsideADialog: Story = {
  render: () => (
    <Dialog.Root open>
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>Budget</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Tooltip content="Spend is measured over the current period." open showArrow>
            <Button size="sm" variant="outline">
              Period spend
            </Button>
          </Tooltip>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  ),
};
