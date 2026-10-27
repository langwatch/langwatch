import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ScrollEdgeFade, useScrollEdges } from "./scroll-fade.tsx";

const TABS = ["Overview", "Users", "Topics", "LLM Metrics", "Online Evaluations", "Custom"];

function HorizontalStrip({ width }: { width: string }) {
  const scroller = useScrollEdges();
  return (
    <Box position="relative" width={width} borderWidth="1px" borderColor="border.card">
      <Box ref={scroller.ref} overflowX="auto">
        <HStack gap={4} paddingX={3} paddingY={2} width="max-content">
          {TABS.map((tab) => (
            <Text key={tab} fontSize="sm" whiteSpace="nowrap">
              {tab}
            </Text>
          ))}
        </HStack>
      </Box>
      <ScrollEdgeFade edge="start" visible={scroller.start} />
      <ScrollEdgeFade edge="end" visible={scroller.end} />
    </Box>
  );
}

function VerticalList() {
  const scroller = useScrollEdges({ axis: "y" });
  return (
    <Box position="relative" width="200px" height="160px" borderWidth="1px">
      <Box ref={scroller.ref} overflowY="auto" height="full">
        <Stack gap={2} padding={3}>
          {Array.from({ length: 14 }, (_, index) => (
            <Text key={index} fontSize="sm">
              Settings entry {index + 1}
            </Text>
          ))}
        </Stack>
      </Box>
      <ScrollEdgeFade edge="top" visible={scroller.start} />
      <ScrollEdgeFade edge="bottom" visible={scroller.end} />
    </Box>
  );
}

const meta = {
  title: "Navigation and layout/Scroll fade",
  parameters: {
    usage: {
      use: "Any strip, table or list that scrolls inside a fixed box: the fade marks the edge that still hides content.",
      avoid:
        "A box that fits its content, or a page that scrolls as a whole (the browser shows that).",
    },
  },
  component: ScrollEdgeFade,
  tags: ["autodocs"],
  args: { edge: "end", visible: true },
} satisfies Meta<typeof ScrollEdgeFade>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NarrowStrip: Story = { render: () => <HorizontalStrip width="260px" /> };

export const StripThatFits: Story = { render: () => <HorizontalStrip width="720px" /> };

export const VerticalListOverflowing: Story = { render: () => <VerticalList /> };
