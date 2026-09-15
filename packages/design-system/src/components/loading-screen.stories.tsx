import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LoadingScreen } from "./loading-screen.tsx";

const meta = {
  title: "Patterns/Loading screen",
  component: LoadingScreen,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
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
