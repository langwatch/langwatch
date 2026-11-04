import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { VersionList } from "./version-list.tsx";

const meta = {
  title: "Data display/Version list",
  parameters: {
    usage: {
      use: "The saved versions of an agent or evaluator in its history drawer, with their deploy labels.",
      avoid: "An audit trail of actions: use the activity timeline.",
    },
  },
  component: VersionList,
  tags: ["autodocs"],
  args: {
    versions: [
      {
        id: "v3",
        version: 3,
        labels: ["production"],
        commitMessage: "Point at the new endpoint",
        author: { name: "Ada", email: "ada@example.com" },
        authorKind: "user",
        createdAtLabel: "2 hours ago",
      },
      {
        id: "v2",
        version: 2,
        labels: [],
        commitMessage: null,
        author: null,
        authorKind: "api_key",
        createdAtLabel: "yesterday",
      },
      {
        id: "v1",
        version: 1,
        labels: ["staging"],
        commitMessage: null,
        author: null,
        authorKind: null,
        createdAtLabel: "last week",
      },
    ],
  },
  render: (args) => (
    <Box maxWidth="420px">
      <VersionList {...args} />
    </Box>
  ),
} satisfies Meta<typeof VersionList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { versions: [] } };
