import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { ScopeFilter, type ScopeFilterValue } from "./scope-filter.tsx";

const meta = {
  title: "Inputs and forms/Scope filter",
  parameters: {
    usage: {
      use: "Narrowing a page to the organization, teams and projects a reader may see.",
      avoid: "Choosing where a resource applies: use Scope chip picker.",
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({ initial }: { initial: ScopeFilterValue }) {
  const [value, setValue] = useState(initial);
  return (
    <ScopeFilter
      value={value}
      onChange={setValue}
      available={{
        organization: { id: "org-1", name: "Acme" },
        teams: [{ id: "team-1", name: "Platform" }],
        projects: [{ id: "project-1", name: "Support bot", teamId: "team-1" }],
      }}
      currentTeamId="team-1"
      currentProjectId="project-1"
    />
  );
}

export const Default: Story = {
  render: () => <Demo initial={{ kind: "all" }} />,
};
