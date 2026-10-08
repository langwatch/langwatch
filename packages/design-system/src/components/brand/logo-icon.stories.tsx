import type { Meta, StoryObj } from "@storybook/react-vite";

import { LogoIcon } from "./logo-icon.tsx";

const meta = {
  title: "Foundations/Logo icon",
  component: LogoIcon,
  tags: ["autodocs"],
} satisfies Meta<typeof LogoIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Follows the colour mode; the full matrix of modes and sizes is under Full logo. */
export const Default: Story = {};

export const Rail: Story = { args: { height: 30 } };

export const Dark: Story = { args: { height: 24, forceColorMode: "dark" } };
