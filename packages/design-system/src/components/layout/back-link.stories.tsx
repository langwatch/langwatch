import type { Meta, StoryObj } from "@storybook/react-vite";

import { BackLink } from "./back-link.tsx";

const meta = {
  title: "Components/Back link",
  component: BackLink,
  tags: ["autodocs"],
  args: { href: "/gateway/budgets", onNavigate: () => {}, children: "Budgets" },
} satisfies Meta<typeof BackLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
