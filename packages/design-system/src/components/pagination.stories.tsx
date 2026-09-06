import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pagination } from "./pagination";

const meta = {
  title: "Components/Pagination",
  component: Pagination,
  tags: ["autodocs"],
  args: {
    page: 3,
    pageSize: 25,
    totalCount: 248,
    unitLabel: "traces",
    onPageChange: () => undefined,
    onPageSizeChange: () => undefined,
  },
  argTypes: { isPageReachable: { control: false } },
  render: (args) => (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" overflow="hidden">
      <Pagination {...args} />
    </Box>
  ),
} satisfies Meta<typeof Pagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FirstPage: Story = {
  args: { page: 1 },
};

export const LastPage: Story = {
  args: { page: 10 },
};

/** The count is not in yet, so the summary is a placeholder and the controls are inert. */
export const Loading: Story = {
  args: { isLoading: true },
};

/** A known count of zero draws nothing at all. */
export const Empty: Story = {
  args: { totalCount: 0 },
};

/** A page that ran short: the range ends where the data ends. */
export const PartialPage: Story = {
  args: { page: 10, visibleCount: 6 },
};

/** An editor blocking navigation while a save is in flight. */
export const NavigationDisabled: Story = {
  args: { navDisabled: true },
};

/** A cursor-only source can open the pages it has walked and the next one, and no others. */
export const CursorOnly: Story = {
  args: {
    page: 2,
    isPageReachable: (page: number) => page <= 3,
    canGoNext: true,
  },
};

export const WithoutATotal: Story = {
  args: { unitLabel: undefined },
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box
      maxWidth="360px"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      overflow="hidden"
    >
      <Pagination {...args} />
    </Box>
  ),
};
