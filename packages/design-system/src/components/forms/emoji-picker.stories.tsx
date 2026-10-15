import { HStack, Input } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { EmojiPicker } from "./emoji-picker.tsx";

const meta = {
  title: "Inputs and forms/Emoji picker",
  parameters: {
    usage: {
      use: "Choosing the icon of something the customer names, such as a workflow or an agent.",
      avoid: "Picking from a fixed list of options: use Select or a segmented control.",
    },
  },
  component: EmojiPicker,
  tags: ["autodocs"],
  args: { value: "🧩", onChange: () => {} },
  render: function Render(args) {
    const [icon, setIcon] = useState(args.value);
    return (
      <HStack maxWidth="sm">
        <EmojiPicker {...args} value={icon} onChange={setIcon} />
        <Input defaultValue="Custom Evaluator" />
      </HStack>
    );
  },
} satisfies Meta<typeof EmojiPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
