import type { Meta, StoryObj } from "@storybook/react-vite";

import { DeleteConfirmationDialog } from "./delete-confirmation-dialog.tsx";

const meta = {
  title: "Overlays/Delete confirmation dialog",
  parameters: { usage: { use: "Confirming a destructive delete." } },
  component: DeleteConfirmationDialog,
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: () => void 0,
    onConfirm: () => void 0,
  },
} satisfies Meta<typeof DeleteConfirmationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Delete stays disabled until the word is typed. */
export const Default: Story = {};

export const CustomCopy: Story = {
  args: {
    title: "Delete this dataset?",
    description: "Evaluations that already ran keep their results, but the dataset itself is gone.",
  },
};

export const Closed: Story = {
  args: { open: false },
};

export const RelatedItems: Story = {
  args: {
    title: "Delete workflow?",
    description: 'You are about to delete "Quality evaluator". This action cannot be undone.',
    consequences: [
      { label: "Evaluators", action: "archived", items: [{ id: "e", name: "Quality evaluator" }] },
      { label: "Agents", action: "archived", items: [{ id: "a", name: "Support agent" }] },
      {
        label: "Online Evaluations",
        action: "deleted",
        items: [{ id: "m", name: "Quality monitor" }],
      },
    ],
  },
};

export const Loading: Story = { args: { isLoading: true, value: "delete" } };
export const LoadingRelated: Story = { args: { isLoadingRelated: true } };
export const Ready: Story = { args: { value: "delete" } };
export const Narrow: Story = { ...RelatedItems, globals: { viewport: { value: "mobile1" } } };
export const LongNames: Story = {
  args: {
    ...RelatedItems.args,
    consequences: [
      {
        label: "Agents",
        action: "archived",
        items: Array.from({ length: 8 }, (_, i) => ({
          id: `${i}`,
          name: `Support agent for a long customer workflow name ${i + 1}`,
        })),
      },
    ],
  },
};
