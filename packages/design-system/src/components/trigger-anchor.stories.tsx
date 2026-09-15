import { Button } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Menu } from "./menu.tsx";
import { Tooltip } from "./tooltip.tsx";
import { TriggerAnchor } from "./trigger-anchor.tsx";

const meta = {
  title: "Primitives/Trigger anchor",
  component: TriggerAnchor,
  tags: ["autodocs"],
  argTypes: { children: { control: false } },
} satisfies Meta<typeof TriggerAnchor>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A menu trigger that also carries a tooltip needs a DOM node of its own, or
 * the tooltip's identifier overwrites the trigger's and the menu opens at the
 * page origin.
 */
export const MenuTriggerInsideATooltip: Story = {
  render: () => (
    <Tooltip content="Choose a role for the new message">
      <TriggerAnchor>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button size="sm" variant="outline">
              Add message
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item value="user">User</Menu.Item>
            <Menu.Item value="assistant">Assistant</Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </TriggerAnchor>
    </Tooltip>
  ),
};
