import type { Meta, StoryObj } from "@storybook/react-vite";

import { LoadMore } from "./load-more.tsx";

const meta = {
  title: "Navigation and layout/Load more",
  parameters: {
    usage: {
      use: "Under an appending list or feed (run history, deliveries in a drawer): the count so far and one Load more button until the end.",
      avoid: "A table with pages: use Pagination. A hand-built Load more button.",
    },
  },
  component: LoadMore,
  tags: ["autodocs"],
  args: {
    hasMore: true,
    loading: false,
    onLoadMore: () => undefined,
    shown: 50,
    total: 212,
    unitLabel: "runs",
  },
} satisfies Meta<typeof LoadMore>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Loading: Story = { args: { loading: true } };
export const WithoutTotal: Story = { args: { total: undefined } };
export const AtTheEnd: Story = { args: { hasMore: false, shown: 212 } };

export const CustomLabel: Story = { args: { label: "Load older chats" } };
export const CompactLongLabel: Story = {
  args: {
    label: "Load older chats",
    "aria-label": "Load older conversations",
    appearance: "compact",
  },
};
