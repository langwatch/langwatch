import type { Meta, StoryObj } from "@storybook/react-vite";

import { RestrictedAccess } from "./restricted-access.tsx";

const meta = {
  title: "Feedback/Restricted access",
  parameters: {
    usage: {
      use: "In place of a page the viewer's role cannot open: what is missing and who can grant it.",
      avoid: "Never hide the page silently or show a generic error.",
    },
  },
  component: RestrictedAccess,
  tags: ["autodocs"],
  args: { permission: "datasets:view" },
} satisfies Meta<typeof RestrictedAccess>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NamedArea: Story = {
  args: { permission: "model-providers:manage", area: "model providers" },
};

export const LongArea: Story = {
  args: {
    permission: "scim-directory-provisioning:manage",
    area: "directory provisioning for every team in this organization",
    requesterName: "Alexandra Montgomery-Fairweather",
  },
};
