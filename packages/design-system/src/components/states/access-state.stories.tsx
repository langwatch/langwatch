import { Button } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { AccessState } from "./access-state.tsx";

const meta = {
  title: "Feedback/Access state",
  component: AccessState,
  tags: ["autodocs"],
  args: {
    kind: "upgrade",
    title: "Custom roles on Enterprise",
    description:
      "Your current plan doesn't include custom roles. Compare plans, or ask an organization admin about changing your plan.",
    actions: <Button colorPalette="orange">Compare plans</Button>,
  },
} satisfies Meta<typeof AccessState>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Compact: Story = { args: { compact: true } };
export const Permission: Story = {
  args: {
    kind: "permission",
    title: "You don't have access to this page",
    description:
      "Your role doesn't let you view governance. Ask an organization admin to give you access.",
    actions: <Button colorPalette="orange">Copy access request</Button>,
  },
};
export const Unavailable: Story = {
  args: {
    kind: "unavailable",
    title: "This page is not here",
    description:
      "The address may have changed, or this page isn't available for your organization.",
    actions: <Button>Go back</Button>,
  },
};
export const LongText: Story = {
  args: { title: "Directory provisioning for every team in your organization on Enterprise" },
};
export const Narrow: Story = {
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
};
