import type { Meta, StoryObj } from "@storybook/react-vite";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";

const meta = {
  title: "Components/Delete confirmation dialog",
  component: DeleteConfirmationDialog,
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: () => undefined,
    onConfirm: () => undefined,
  },
} satisfies Meta<typeof DeleteConfirmationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Delete stays disabled until the word is typed. */
export const Default: Story = {};

export const CustomCopy: Story = {
  args: {
    title: "Delete this dataset?",
    description:
      "Evaluations that already ran keep their results, but the dataset itself is gone. Type 'delete' below to confirm:",
  },
};

export const Closed: Story = {
  args: { open: false },
};
