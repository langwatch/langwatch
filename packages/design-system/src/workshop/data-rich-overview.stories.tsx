import { Box } from "@langwatch/design-system/primitives";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DataRichOverview, type DataRichOverviewStart } from "./data-rich-overview.example.tsx";
import { dataRichOverviewSource } from "./data-rich-overview.source.ts";

const meta = {
  title: "Patterns/Data-rich overview",
  component: DataRichOverview,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    usage: {
      use: "An overview that leads from a trend to the records that need attention: figures, a chart you can switch, then a table you can search, sort, page and act on.",
      avoid:
        "A table with no trend above it: use a list page. Thousands of rows loaded at once: keep the production table's virtual scrolling, and do not page it like this example.",
    },
    docs: {
      story: { inline: false, iframeHeight: 760 },
      source: { code: dataRichOverviewSource, language: "tsx" },
      description: {
        component: [
          "**When to use it.** Monitoring, usage and cost pages: anywhere a reader first wants the shape of the week and then the individual items behind it. The figures say how much, the chart says when, the table says which ones.",
          "",
          "**How it is built.** The design system owns every shape; the example owns the local state; your application owns the queries, the refresh and the export.",
          "",
          "| Part | Shape | What it owns |",
          "| --- | --- | --- |",
          "| The figures | `StatTileGrid` of `StatTile` | Four labelled figures with their units, a skeleton while they load. |",
          "| The trend | `MetricTabs` and `TimeSeriesChart` | A headline figure per tab. Arrow keys move between tabs; Enter or Space opens one, so arrowing past does not change the chart. The chart draws its own grid, colour, hover reading and a written summary for screen readers. |",
          "| The toolbar | `TableToolbar` with `FilterChips` and `ColumnPicker` | Search, status filter with counts, a summary, Clear filters, and the column picker. |",
          "| The table | `ListTable` with `SortHeader`, `SelectCell`, `RowAction`, `ActionCell` | Sortable time and cost, a checkbox per row, one native button per row that opens it, and a menu that never opens the row. |",
          '| The selection | `SelectionActionBar` | Floating on a page; `selectionPlacement="inline"` draws it as the toolbar\'s first band inside a drawer or dialog. |',
          "| The paging | `Pagination` | Ten rows per page and a known total. |",
          "| The detail and export | `Drawer`, `Dialog` | A read-only drawer for one trace; a preview of the CSV for the export. |",
          "| The states | `ListTable.EmptyRow`, `Banner`, skeletons | Loading, empty, no results, failed and refresh failed. Empty, no results and failed carry a next step. |",
          "",
          "**The table, on purpose.** Fixture pages of ten rows with a known total, so it uses `Pagination` and not `LoadMore`. It is not virtual and has no expansion. Selection is kept by trace id: sorting, paging, searching and filtering never drop a ticked row, the bar counts every ticked trace and Clear selection empties it. Changing the sort, the search or the filter returns to page one. A production trace table with many thousands of rows keeps its virtual scrolling.",
          "",
          "**Real screens, joined for teaching.** This is a composite and no one screen joins all of it. The metrics and tabs come from the analytics overview (`modules/analytics/browser/src/ui/sections/analytics/analytics-overview.screen.tsx`, joined metrics at line 57 and `MetricTabs` at line 94). The four tiles and the trend are from gateway usage (`modules/gateway/browser/src/ui/sections/gateway/gateway-usage.screen.tsx`, tiles at line 374 and trend at line 397). The selection bar and export are from the trace explorer (`modules/trace/browser/src/ui/sections/explorer/toolbar/bulk-action-bar.tsx`, line 67). Gateway usage has no selection and the trace explorer has no trend; this example does not claim otherwise.",
          "",
          "**Copy it.** The source under the first example is the whole file: imports, types, fixtures, state and the stand-in `refreshLocally`. Inside the application's design system provider it runs as it is. Replace `refreshLocally` with your refresh, `SEED_TRACES` and `DAILY` with your data, pass `onExport` to write the file, and delete the `start` prop, which exists only to open the stories in a given state.",
          "",
          "See also [Using them together](?path=/docs/patterns-using-them-together--docs) for the whole set.",
        ].join("\n"),
      },
    },
  },
} satisfies Meta<typeof DataRichOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One short line in each story's code panel; the full file is under Default. */
function startSnippet({ start }: { start: string }): { docs: { source: { code: string } } } {
  return {
    docs: {
      source: {
        code: `// The whole file is shown under Default.\n<DataRichOverview start={${start}} />`,
      },
    },
  };
}

function overview({ start }: { start?: DataRichOverviewStart }) {
  return () => <DataRichOverview start={start} />;
}

/** Four figures, the requests trend and the first ten traces. Open a name, tick rows, sort. */
export const Default: Story = {
  render: () => <DataRichOverview />,
};

/** Two ticked rows: the floating bar counts them and exports only them. */
export const SelectedRows: Story = {
  parameters: startSnippet({ start: `{ selected: [2, 5] }` }),
  render: overview({ start: { selected: [2, 5] } }),
};

/** Inside a drawer or dialog the same bar sits in the toolbar instead of floating. */
export const InlineSelection: Story = {
  parameters: {
    docs: {
      source: {
        code: `// The whole file is shown under Default.\n<DataRichOverview selectionPlacement="inline" start={{ selected: [2, 5] }} />`,
      },
    },
  },
  render: () => <DataRichOverview selectionPlacement="inline" start={{ selected: [2, 5] }} />,
};

/** Page two of three: ticked rows on page one stay ticked. */
export const SecondPage: Story = {
  parameters: startSnippet({ start: `{ page: 2, selected: [2] }` }),
  render: overview({ start: { page: 2, selected: [2] } }),
};

/** Everything loading: skeleton figures and chart, placeholder rows, a disabled search. */
export const Loading: Story = {
  parameters: startSnippet({ start: `{ metrics: "loading", traces: "loading" }` }),
  render: overview({ start: { metrics: "loading", traces: "loading" } }),
};

/** A new project: zero figures, an empty chart and a table with a docs link and an agent prompt. */
export const Empty: Story = {
  parameters: startSnippet({ start: `{ metrics: "empty", traces: "empty" }` }),
  render: overview({ start: { metrics: "empty", traces: "empty" } }),
};

/** A search that matches nothing: Clear filters and a prompt for a coding agent. */
export const NoResults: Story = {
  parameters: startSnippet({ start: `{ query: "chargeback", status: "error" }` }),
  render: overview({ start: { query: "chargeback", status: "error" } }),
};

/** The trace service did not answer: Try again, and a docs page for when retrying does not help. */
export const Failed: Story = {
  parameters: startSnippet({ start: `{ traces: "error" }` }),
  render: overview({ start: { traces: "error" } }),
};

/** A refresh in flight keeps the rows on screen, marks the table busy and says so. */
export const Refreshing: Story = {
  parameters: startSnippet({ start: `{ refresh: "refreshing" }` }),
  render: overview({ start: { refresh: "refreshing" } }),
};

/** A refresh that failed keeps the old rows and says so above them. */
export const RefreshFailed: Story = {
  parameters: startSnippet({ start: `{ refresh: "failed" }` }),
  render: overview({ start: { refresh: "failed" } }),
};

/** No metrics to plot yet while traces exist: the chart keeps its box and says why. */
export const ChartEmpty: Story = {
  parameters: startSnippet({ start: `{ metrics: "empty" }` }),
  render: overview({ start: { metrics: "empty" } }),
};

/** At 390 pixels the figures stack and the table scrolls inside its own region. */
export const Narrow: Story = {
  parameters: {
    ...startSnippet({ start: `{}` }),
    docs: { story: { inline: false, iframeHeight: 640 }, source: { code: "<DataRichOverview />" } },
  },
  decorators: [
    (Story) => (
      <Box maxWidth="390px" borderWidth="1px" borderColor="border.muted">
        <Story />
      </Box>
    ),
  ],
  render: () => <DataRichOverview />,
};
