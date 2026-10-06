import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExternalLink } from "lucide-react";

import { HStack } from "../primitives.ts";
import { WorkflowCardDisplay, WorkflowIcon } from "./workflow-card.tsx";

const meta = {
  title: "Components/Workflow card",
  component: WorkflowCardDisplay,
  tags: ["autodocs"],
  args: {
    name: "Support triage",
    icon: "🧭",
    updatedAtLabel: "Updated 2 hours ago",
    width: "300px",
  },
} satisfies Meta<typeof WorkflowCardDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = { args: { action: <ExternalLink size={16} /> } };

export const Clickable: Story = { args: { onClick: () => undefined } };

export const WithDescription: Story = {
  args: { description: "Routes each ticket to the right queue and drafts a first reply." },
};

export const LongNameNarrow: Story = {
  args: { name: "A workflow whose name runs on far longer than the card is wide", width: "200px" },
};

export const NoTimestamp: Story = { args: { updatedAtLabel: undefined } };

export const IconSizes: Story = {
  render: () => (
    <HStack gap={3}>
      <WorkflowIcon icon="🧭" size="xs" />
      <WorkflowIcon icon="🧭" size="md" />
      <WorkflowIcon icon="🧭" size="lg" />
    </HStack>
  ),
};
