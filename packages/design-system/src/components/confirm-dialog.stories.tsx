import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConfirmDialog } from "./confirm-dialog.tsx";

const meta = {
  title: "Components/Confirm dialog",
  component: ConfirmDialog,
  tags: ["autodocs"],
  args: {
    open: true,
    title: "Revoke this virtual key?",
    message: "Every caller using it stops working immediately. This cannot be undone.",
    confirmLabel: "Revoke key",
    tone: "danger",
    onOpenChange: () => undefined,
    onConfirm: () => undefined,
  },
  argTypes: { tone: { control: "inline-radio", options: ["danger", "warning"] } },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Warning: Story = {
  args: {
    tone: "warning",
    title: "Archive this budget?",
    message: "Spend keeps being recorded, but the budget stops enforcing its limit.",
    confirmLabel: "Archive budget",
  },
};

export const Loading: Story = {
  args: { loading: true },
};

export const Closed: Story = {
  args: { open: false },
};

export const LongText: Story = {
  args: {
    title: "Disable the provider binding for every project in this organization?",
    message:
      "Requests routed to this provider start failing the moment the binding is disabled. Traffic does not fall back to another provider automatically, so any virtual key pinned to it returns an error until a new binding is created.",
  },
};
