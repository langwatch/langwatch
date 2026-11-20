import type { Meta, StoryObj } from "@storybook/react-vite";

import { Box } from "../../primitives.ts";
import { ProjectPicker } from "./project-picker.tsx";

const meta = {
  title: "Navigation and layout/Project picker",
  parameters: {
    usage: {
      use: "Switching the current project, wherever a page offers it: the top bar and every page that borrows project's switcher. Pointing at a row (or arrowing to it) shows that project's ID with a copy button.",
      avoid:
        "Building another project menu: hand this picker the groups instead. Choosing scopes for a resource: use Scope chip picker.",
    },
  },
  component: ProjectPicker,
  tags: ["autodocs"],
  args: {
    currentProjectId: "project_0000aBcDeFgHiJH1Ziwj",
    currentProjectName: "Web",
    showTeamHeaders: true,
    onOpenProject: () => void 0,
    groups: [
      {
        team: { teamId: "team-platform", orgId: "org-1", label: "Platform" },
        projects: [
          { projectId: "project_0000aBcDeFgHiJH1Ziwj", label: "Web", href: "/web" },
          { projectId: "project_0000kLmNoPqRsTSr4Pwe", label: "Api", href: "/api" },
        ],
      },
      {
        team: { teamId: "team-growth", orgId: "org-1", label: "Growth" },
        projects: [
          { projectId: "project_0000uVwXyZaBcDLe4dSc", label: "Lead scorer", href: "/leads" },
          {
            projectId: "project_0000eFgHiJkLmNA11Prj",
            label: "Everything",
            href: "/all",
            isAggregate: true,
          },
        ],
      },
    ],
  },
} satisfies Meta<typeof ProjectPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OneTeam: Story = {
  args: {
    showTeamHeaders: false,
    groups: [
      {
        team: { teamId: "team-platform", orgId: "org-1", label: "Platform" },
        projects: [
          { projectId: "project_0000aBcDeFgHiJH1Ziwj", label: "Web", href: "/web" },
          { projectId: "project_0000kLmNoPqRsTSr4Pwe", label: "Api", href: "/api" },
        ],
      },
    ],
  },
};

export const WithCreateEntries: Story = {
  args: {
    onCreateProjectForTeam: () => void 0,
    groups: [
      {
        team: {
          teamId: "team-platform",
          orgId: "org-1",
          label: "Platform",
          canCreateProject: true,
        },
        projects: [{ projectId: "project_0000aBcDeFgHiJH1Ziwj", label: "Web", href: "/web" }],
      },
    ],
  },
};

export const LongProjectName: Story = {
  args: {
    currentProjectName: "Customer support assistant for the European billing desk",
  },
};

/** A page header on a narrow screen: the chip stays bounded and the long name truncates. */
export const NarrowHeader: Story = {
  args: {
    align: "end",
    currentProjectName: "Customer support assistant for the European billing desk",
  },
  decorators: [
    (Story) => (
      <Box width="320px" display="flex" justifyContent="flex-end" borderWidth="1px" padding={2}>
        <Story />
      </Box>
    ),
  ],
};
