import type { Meta, StoryObj } from "@storybook/react-vite";

import { ProviderScopeChips } from "./provider-scope-chips.tsx";

const meta = {
  title: "Data display/Provider scope chips",
  parameters: {
    usage: {
      use: "Where a provider or key is available, as read-only chips.",
      avoid: "Choosing scopes: use Scope chip picker.",
    },
  },
  component: ProviderScopeChips,
  tags: ["autodocs"],
  args: {
    scopes: [
      { scopeType: "ORGANIZATION", scopeId: "org-1", name: "Acme" },
      { scopeType: "TEAM", scopeId: "team-1", name: "Platform" },
      { scopeType: "PROJECT", scopeId: "project-1", name: "Support bot" },
    ],
  },
} satisfies Meta<typeof ProviderScopeChips>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const System: Story = { args: { scopes: [], system: true } };
