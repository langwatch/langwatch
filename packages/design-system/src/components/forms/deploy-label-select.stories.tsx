import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { DeployLabelSelect } from "./deploy-label-select.tsx";

const meta = {
  title: "Inputs and forms/Deploy label select",
  parameters: {
    usage: {
      use: "Choosing which deploy label of an agent or evaluator a monitor or experiment runs.",
      avoid: "Moving a label to another version: use the deploy dialog.",
    },
  },
  component: DeployLabelSelect,
  tags: ["autodocs"],
  args: {
    value: undefined,
    onChange: () => undefined,
    labels: [
      { label: "production", version: 2 },
      { label: "staging", version: 3 },
    ],
    latestVersion: 3,
  },
} satisfies Meta<typeof DeployLabelSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => {
    const [value, setValue] = useState<string | undefined>(args.value);
    return (
      <Box maxWidth="280px">
        <DeployLabelSelect {...args} value={value} onChange={setValue} />
      </Box>
    );
  },
};

export const PinnedToProduction: Story = { args: { value: "production" } };

export const RemovedLabel: Story = { args: { value: "canary" } };

export const NoLabels: Story = { args: { labels: [], latestVersion: 1 } };
