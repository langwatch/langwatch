import type { Meta, StoryObj } from "@storybook/react-vite";
import { Copy, Trash2 } from "lucide-react";

import { Box, Text } from "../../primitives.ts";
import { ActionRow } from "./action-row.tsx";

const noop = () => undefined;

const meta = {
  title: "Overlays/Action row",
  parameters: {
    usage: {
      use: 'The footer row a Drawer or Dialog draws from its actions. Render it yourself only where the footer sits outside an overlay (the studio\'s expanded panel). Actions are descriptors: label, onClick or `type: "submit"`, or `items` for a menu.',
      avoid:
        "Hand-built button rows in an overlay: pass the overlay's `footer` or actions. Picking a variant or colour: the row picks them by role.",
    },
  },
  component: ActionRow,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box borderTopWidth="1px" borderColor="border.card" padding={4} maxWidth="42rem">
        <Story />
      </Box>
    ),
  ],
  args: { primaryAction: { label: "Save", onClick: noop } },
} satisfies Meta<typeof ActionRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PrimaryOnly: Story = {};

export const EveryRole: Story = {
  args: {
    destructiveAction: { label: "Delete", icon: <Trash2 size={14} />, onClick: noop },
    utilityActions: [{ label: "Duplicate", icon: <Copy size={14} />, onClick: noop }],
    cancel: { onClick: noop },
    secondaryAction: { label: "Save draft", onClick: noop },
    primaryAction: { label: "Publish", onClick: noop },
  },
};

export const MenuAction: Story = {
  args: {
    primaryAction: {
      label: "Export",
      items: [
        { value: "csv", label: "As CSV", onSelect: noop },
        { value: "json", label: "As JSON", onSelect: noop, disabledReason: "Too many rows" },
      ],
    },
  },
};

export const WithReason: Story = {
  args: {
    primaryAction: { label: "Deploy", onClick: noop, disabledReason: "Only admins can deploy" },
  },
};

export const DangerConfirm: Story = {
  args: {
    cancel: { onClick: noop },
    primaryAction: { label: "Revoke key", onClick: noop, danger: true },
  },
};

export const WithSummary: Story = {
  args: {
    summary: <Text textStyle="sm">12 seats · $240 a month, prorated $96 today</Text>,
    note: "Step 3 of 3",
  },
};

export const Busy: Story = {
  args: { busy: true, primaryAction: { label: "Save", onClick: noop, loading: true } },
};
