import type { Meta, StoryObj } from "@storybook/react-vite";
import { BarChart3, FlaskConical, MessageSquare } from "lucide-react";

import { HeroLeadPill } from "./hero-lead-pill.tsx";

const glyphs = [
  { key: "traces", icon: <MessageSquare size={10} />, color: "blue.fg" },
  { key: "analytics", icon: <BarChart3 size={10} />, color: "green.fg" },
  { key: "evaluations", icon: <FlaskConical size={10} />, color: "purple.fg" },
];

const meta = {
  title: "Components/Hero lead pill",
  component: HeroLeadPill,
  tags: ["autodocs"],
  args: {
    label: "Explore your project",
    glyphs,
  },
  argTypes: {
    glyphs: { control: false },
  },
} satisfies Meta<typeof HeroLeadPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Quiet: Story = {};

export const Prominent: Story = {
  args: { prominent: true },
};
