import { Box, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { ResizeHandle } from "./resize-handle.tsx";

const DEFAULT_WIDTH = 212;

function ResizableColumn({ edge = "right" }: { edge?: "left" | "right" }) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  return (
    <Box
      display="flex"
      flexDirection={edge === "left" ? "row-reverse" : "row"}
      height="240px"
      borderWidth="1px"
      borderRadius="md"
    >
      <Box position="relative" width={`${width}px`} flexShrink={0} padding={3} bg="bg.muted">
        <Text truncate>Analytics: LLM Metrics and costs per customer</Text>
        <ResizeHandle
          label="Resize sidebar"
          edge={edge}
          value={width}
          min={DEFAULT_WIDTH}
          max={480}
          onChange={setWidth}
          onReset={() => setWidth(DEFAULT_WIDTH)}
        />
      </Box>
      <Box flex={1} padding={3}>
        <Text color="fg.muted">{width}px</Text>
      </Box>
    </Box>
  );
}

const meta = {
  title: "Navigation and layout/Resize handle",
  parameters: {
    usage: {
      use: "On a column's right edge, so the reader can drag it wider to read long names.",
    },
  },
  component: ResizeHandle,
  tags: ["autodocs"],
  args: {
    label: "Resize sidebar",
    value: DEFAULT_WIDTH,
    min: DEFAULT_WIDTH,
    max: 480,
    onChange: () => {},
  },
  render: () => <ResizableColumn />,
} satisfies Meta<typeof ResizeHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LeftEdge: Story = { render: () => <ResizableColumn edge="left" /> };
