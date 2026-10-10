import type { Meta, StoryObj } from "@storybook/react-vite";

import { Box, Text } from "../../primitives.ts";
import { SuggestionPanel } from "./suggestion-panel.tsx";

const meta = {
  title: "Feedback/Suggestion panel",
  parameters: {
    usage: {
      use: "The panel suggestions sit in under an input, with key hints in its foot.",
      avoid: "A list of actions: use Menu.",
    },
  },
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
