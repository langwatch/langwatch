import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { JsonValuePreview } from "./json-value-preview.tsx";

const meta = {
  title: "Data display/JSON value preview",
  component: JsonValuePreview,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "A compact live JSON value, with changed fields highlighted against the preceding snapshot. Ops uses this for polled state and pinned JSON values.",
      avoid:
        "Code files and unified diffs: use CodePreview for syntax highlighting, copying, line numbers, and removed lines. This component highlights current fields, not removed fields.",
    },
  },
  args: { data: { process: "Webhook delivery", pending: 12, healthy: true, checkpoint: null } },
} satisfies Meta<typeof JsonValuePreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const ChangedSnapshot: Story = {
  args: {
    previousData: { process: "Webhook delivery", pending: 12, healthy: true, checkpoint: null },
    data: { process: "Webhook delivery", pending: 8, healthy: true, checkpoint: { revision: 42 } },
  },
};
export const Empty: Story = { args: { data: {} } };
export const Array: Story = {
  args: {
    data: [
      { name: "Webhook delivery", pending: 12 },
      { name: "Evaluation", pending: 0 },
    ],
  },
};
export const Narrow: Story = {
  args: {
    data: {
      process: "Production webhook delivery for all connected projects in Europe",
      state: { pending: 12 },
    },
  },
  decorators: [
    (Story) => (
      <Box maxWidth="240px">
        <Story />
      </Box>
    ),
  ],
};
