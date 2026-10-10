import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { LoadingScreen } from "./loading-screen.tsx";

const meta = {
  title: "Feedback/Loading screen",
  component: LoadingScreen,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "The full-page wait before the application shell is ready.",
      avoid: "Inside a page: Skeleton or Spinner from primitives.",
    },
    layout: "fullscreen",
  },
} satisfies Meta<typeof LoadingScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The whole page while the first route is still resolving. */
export const Default: Story = {};

/** Inside a panel, to show how the mark and the mesh scale down. */
export const InsideAPanel: Story = {
  render: () => (
    <Box height="320px" overflow="hidden" borderWidth="1px" borderColor="border.muted">
      <LoadingScreen />
    </Box>
  ),
};
