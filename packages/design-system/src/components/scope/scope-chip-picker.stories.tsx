import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { ScopeChipPicker, type ScopeTriadEntry } from "./scope-chip-picker.tsx";

const meta = {
  title: "Inputs and forms/Scope chip picker",
  parameters: {
    usage: {
      use: "Choosing the organization, team, project or department a resource applies to.",
      avoid:
        "Never a hand-rolled Select for scopes (scope-selector-and-badges.md). Showing scopes read-only: use Provider scope chips.",
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({ initial }: { initial: ScopeTriadEntry[] }) {
  const [value, setValue] = useState(initial);
  return (
    <ScopeChipPicker
      value={value}
      onChange={setValue}
      organizationId="org-1"
      organizationName="Acme"
      availableTeams={[{ id: "team-1", name: "Platform" }]}
      availableProjects={[{ id: "project-1", name: "Support bot", teamId: "team-1" }]}
    />
  );
}

export const Default: Story = {
  render: () => <Demo initial={[{ scopeType: "ORGANIZATION", scopeId: "org-1" }]} />,
};

export const ProjectSelected: Story = {
  render: () => <Demo initial={[{ scopeType: "PROJECT", scopeId: "project-1" }]} />,
};
