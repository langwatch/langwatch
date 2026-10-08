import type { Meta, StoryObj } from "@storybook/react-vite";
import { LuFilter } from "react-icons/lu";

import { Chip } from "./chip.tsx";

const meta = {
  title: "Components/Chip",
  component: Chip,
  tags: ["autodocs"],
  args: { label: "Model", value: "gpt-5-mini" },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Static: Story = {};

export const Toned: Story = {
  args: { tone: "green", dot: "green.solid", icon: LuFilter },
};

export const Clickable: Story = {
  args: { onClick: () => void 0, onFilter: () => void 0 },
};
