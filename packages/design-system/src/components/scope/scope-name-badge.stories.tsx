import type { Meta, StoryObj } from "@storybook/react-vite";

import { NamedScope, ScopeNameBadge } from "./scope-name-badge.tsx";

const meta = {
  title: "Data display/Scope name badge",
  parameters: {
    usage: {
      use: "Naming the team or project a choice or a sentence refers to: Team [Platform].",
      avoid: "Listing where a resource is available: use Provider scope chips.",
    },
  },
  component: ScopeNameBadge,
  tags: ["autodocs"],
  args: { name: "Eval Harness" },
} satisfies Meta<typeof ScopeNameBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongName: Story = {
  args: { name: "Customer support evaluation harness for the enterprise tier" },
};

export const WithKind: Story = {
  render: (args) => <NamedScope kind="Project" name={args.name} />,
};
