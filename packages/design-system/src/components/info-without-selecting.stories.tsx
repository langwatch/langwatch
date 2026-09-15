import { Button, HStack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Info } from "react-feather";
import { InfoWithoutSelecting } from "./info-without-selecting.tsx";
import { Tooltip } from "./tooltip.tsx";

const meta = {
  title: "Primitives/Info without selecting",
  component: InfoWithoutSelecting,
  tags: ["autodocs"],
  args: { children: null },
  argTypes: { children: { control: false } },
} satisfies Meta<typeof InfoWithoutSelecting>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Reading the explanation must not also take the action the row offers. The
 * wrapper stops the pointer, click and key events before they reach the row.
 */
export const InsideAClickableRow: Story = {
  render: () => (
    <Button
      variant="outline"
      onClick={() => window.alert("The row was chosen")}
      justifyContent="start"
      width="260px"
    >
      <HStack gap="2">
        <Text>Lite member</Text>
        <InfoWithoutSelecting>
          <Tooltip content="A lite member reads a project but holds no seat.">
            <Info size={14} />
          </Tooltip>
        </InfoWithoutSelecting>
      </HStack>
    </Button>
  ),
};
