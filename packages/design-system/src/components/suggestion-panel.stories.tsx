import type { Meta, StoryObj } from "@storybook/react-vite";

import { Box, Text } from "../primitives.ts";
import { SuggestionPanel } from "./suggestion-panel.tsx";

const meta = {
  title: "Components/Suggestion panel",
  component: SuggestionPanel,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box position="relative" height="240px">
        <Story />
      </Box>
    ),
  ],
  args: { children: <Text padding={3}>status</Text> },
} satisfies Meta<typeof SuggestionPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
