import { SimpleGrid } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { SkeletonCard, SkeletonRows } from "./skeletons.tsx";

const meta = {
  title: "Feedback/Skeletons",
  parameters: {
    usage: {
      use: "Content that is loading: SkeletonRows for a list or panel, SkeletonCard for a card grid, ListTable.LoadingRows inside a table. Shape them like what is coming.",
      avoid:
        "A centred Spinner as the page or drawer body. A Spinner stays right only inside a busy button.",
    },
  },
  component: SkeletonRows,
  tags: ["autodocs"],
} satisfies Meta<typeof SkeletonRows>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rows: Story = {};

export const RowsWithLeading: Story = { args: { leading: true, rows: 4 } };

export const Cards: Story = {
  render: () => (
    <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
      <SkeletonCard />
      <SkeletonCard lines={2} />
      <SkeletonCard title={false} />
    </SimpleGrid>
  ),
};
