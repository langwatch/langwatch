import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { MeasuredRichTable, makeRichRows } from "../../workshop/list-table-rich-cells.tsx";
import { ListTable } from "./list-table.tsx";

const rows = makeRichRows(200);

const meta = {
  title: "Data display/List table rich cells",
  component: ListTable,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    usage: {
      use: "Proof that the table shell hosts any cell content unchanged: nested markdown, a tool-call tree, a 5,000-character JSON value, a chat transcript, an image and a diff, in a measured virtual table with a sticky header, selection, expansion and a pinned action column. The renderers are plain React the shell never touches; only the shell around them is the design system's.",
      avoid:
        "Rewriting, restyling or simplifying a cell renderer when migrating a table: swap the root, rows, header, geometry, selection and actions, and leave the cell content alone.",
    },
  },
} satisfies Meta<typeof ListTable>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MeasuredVirtual: Story = {
  render: () => (
    <Box padding={4}>
      <MeasuredRichTable rows={rows} />
    </Box>
  ),
};

/** The same table at 320px: the one scroller owns both axes and the pinned columns hold. */
export const MeasuredVirtualNarrow: Story = {
  render: () => (
    <Box maxWidth="320px" padding={2}>
      <MeasuredRichTable rows={rows} viewport={420} />
    </Box>
  ),
};
