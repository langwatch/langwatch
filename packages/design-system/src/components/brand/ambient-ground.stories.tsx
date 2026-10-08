import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { AmbientGround } from "./ambient-ground.tsx";

const meta = {
  title: "Patterns/Ambient ground",
  component: AmbientGround,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <Box position="relative" height="100vh" overflow="hidden">
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof AmbientGround>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At rest, reading area in the middle: what the loading and waiting screens use. */
export const Default: Story = {};

/** Reading area on the left, as the split front door lays it out. */
export const ProtectLeft: Story = { args: { protect: "left" } };

/** Nudged: a wider reach and a softer dissolve, as a later door step sets it. */
export const Shifted: Story = {
  args: {
    shift: {
      rotation: 18,
      offsetX: 0.08,
      offsetY: 0,
      scale: 0.1,
      swirl: 0.1,
      fade: 0.9,
      reach: 1.2,
    },
  },
};
