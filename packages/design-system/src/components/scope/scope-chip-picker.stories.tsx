import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { ScopeChipPicker, type ScopeTriadEntry } from "./scope-chip-picker.tsx";

const meta = {
  title: "Components/Scope chip picker",
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
