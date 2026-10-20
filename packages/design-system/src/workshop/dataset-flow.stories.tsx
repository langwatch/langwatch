import { Box } from "@langwatch/design-system/primitives";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DatasetFlow, SEED_DATASETS, type DatasetFlowStart } from "./dataset-flow.example.tsx";
import { datasetFlowSource } from "./dataset-flow.source.ts";

const FIRST = SEED_DATASETS[0];

const meta = {
  title: "Patterns/Create, edit and delete",
  component: DatasetFlow,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    usage: {
      use: "Managing a catalogue of records without leaving the list: add one, change one, remove one and take the removal back.",
      avoid:
        "A record with its own full-page editor or a long guided setup: open the record's page, or see Guided setup. A deletion that cannot be undone: ask in the dialog and say so.",
    },
    docs: {
      story: { inline: false, iframeHeight: 640 },
      source: { code: datasetFlowSource, language: "tsx" },
      description: {
        component: [
          "**When to use it.** Datasets, prompts, keys, anything a person keeps a short list of and edits in place. The list stays in view behind the form, so the reader sees the new row land.",
          "",
          "**How it is built.** The design system owns every shape; the example owns the local state; your application owns the saving, the routing and the data.",
          "",
          "| Part | Shape | What it owns |",
          "| --- | --- | --- |",
          "| The page | `ListPage` with `PageLayout.HeaderButton` | Title, description, search toolbar, and the loading, empty, no-results and ready states. Empty and no-results must carry a next step. |",
          "| The table | `ListTable` with `RowAction`, `ActionCell` | One native button per row opens it. The trailing menu holds Edit and Delete and never opens the row. |",
          "| The form | `Drawer` with `SettingsField` | Header, scroll body, footer. Cancel is kept in the footer; submit is native, so Enter submits once. |",
          "| The deletion | `ConfirmDialog` | Names the dataset it deletes. The confirm button is red. |",
          "| The notice | `Toaster` | A notice with Undo that stays for ten seconds, as the dataset screen does. |",
          "| The example | `DatasetFlow` | Rows, the draft, validation, focus after a row disappears, and the Undo. |",
          "",
          "**The table, on purpose.** A small catalogue, so the table is not virtual, keeps the default density, has no selection, expansion or paging, and opens a row from the name in its first cell. Search that matches nothing shows the no-results line with Clear filters and a prompt for a coding agent.",
          "",
          "**Real screen.** The dataset list (`modules/dataset/browser/src/ui/sections/datasets.screen.tsx`, the delete with Undo at line 302 and the create and edit wiring at line 424) and its form (`add-or-edit-dataset-drawer.tsx`, validation at line 85, the form at line 219). The example teaches the catalogue and the column definitions only; it does not copy the dataset editor, the upload drawer or the feature's data contract.",
          "",
          "**Copy it.** The source under the first example is the whole file: imports, types, fixtures, state and the stand-in `save`. Inside the application's design system provider it runs as it is. Replace `saveLocally` with a call to your API, `SEED_DATASETS` with your data, and delete the `start` prop, which exists only to open the stories in a given state.",
          "",
          "See also [Using them together](?path=/docs/patterns-using-them-together--docs) for the whole set.",
        ].join("\n"),
      },
    },
  },
} satisfies Meta<typeof DatasetFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One short line in each story's code panel; the full file is under Default. */
function startSnippet({ start }: { start: string }): { docs: { source: { code: string } } } {
  return {
    docs: {
      source: {
        code: `// The whole file is shown under Default.\n<DatasetFlow start={${start}} />`,
      },
    },
  };
}

function flow({ start }: { start?: DatasetFlowStart }) {
  return () => <DatasetFlow start={start} />;
}

/** The list with two datasets: open a name or New dataset, edit, delete and Undo. */
export const Default: Story = {
  render: () => <DatasetFlow />,
};

/** New dataset: a name, the generated slug and two starting columns. */
export const CreateOpen: Story = {
  parameters: startSnippet({ start: `{ form: { mode: "create" } }` }),
  render: flow({ start: { form: { mode: "create" } } }),
};

/** Editing changes the same row: the name and columns arrive filled in. */
export const EditOpen: Story = {
  parameters: startSnippet({ start: `{ form: { mode: "edit", datasetId: 1, … } }` }),
  render: flow({
    start: {
      form: {
        mode: "edit",
        datasetId: FIRST?.id,
        name: FIRST?.name,
        columns: FIRST?.columns,
      },
    },
  }),
};

/** A missing or taken name is said under the name field, and focus goes there. */
export const InvalidName: Story = {
  parameters: startSnippet({ start: `{ form: { problems: { name: "Name is required" } } }` }),
  render: flow({
    start: { form: { mode: "create", problems: { name: "Name is required" } } },
  }),
};

/** Two columns with one name: the error sits under Columns. */
export const DuplicateColumn: Story = {
  parameters: startSnippet({ start: `{ form: { columns: [question, question], problems } }` }),
  render: flow({
    start: {
      form: {
        mode: "create",
        name: "Billing questions",
        columns: [
          { name: "question", type: "string" },
          { name: "question", type: "string" },
        ],
        problems: {
          columns: 'Two columns are called "question". Column names must be unique.',
        },
      },
    },
  }),
};

/** A save in flight: the button shows progress and the form waits. */
export const Saving: Story = {
  parameters: startSnippet({ start: `{ form: { mode: "edit", pending: true, … } }` }),
  render: flow({
    start: {
      form: {
        mode: "edit",
        datasetId: FIRST?.id,
        name: FIRST?.name,
        columns: FIRST?.columns,
        pending: true,
      },
    },
  }),
};

/** A refused save keeps the name and columns and says so above the fields; save again to retry. */
export const SaveFailed: Story = {
  parameters: startSnippet({
    start: `{ form: { failure: "The dataset service did not answer." } }`,
  }),
  render: flow({
    start: {
      form: {
        mode: "create",
        name: "Billing questions",
        failure: "The dataset service did not answer.",
      },
    },
  }),
};

/** Deleting names the dataset and how many entries leave with it. */
export const DeleteConfirm: Story = {
  parameters: startSnippet({ start: `{ confirmDelete: 1 }` }),
  render: flow({ start: { confirmDelete: 1 } }),
};

/** The row is gone and the notice offers Undo for ten seconds. */
export const DeletedWithUndo: Story = {
  parameters: startSnippet({ start: `{ deleted: 1 }` }),
  render: flow({ start: { deleted: 1 } }),
};

/** No datasets: a way to read about them and a prompt for a coding agent. */
export const Empty: Story = {
  parameters: startSnippet({ start: `{ datasets: [] }` }),
  render: flow({ start: { datasets: [] } }),
};

/** Search matched nothing: Clear filters, and a prompt that sets up a dataset of that name. */
export const NoResults: Story = {
  parameters: startSnippet({ start: `{ query: "Billing questions" }` }),
  render: flow({ start: { query: "Billing questions" } }),
};

/** Rows are loading: skeletons, search disabled, and the list marked busy. */
export const Loading: Story = {
  parameters: startSnippet({ start: `{ loading: true }` }),
  render: flow({ start: { loading: true } }),
};

/** At 390 pixels the table scrolls inside its own region and the header actions stay in reach. */
export const Narrow: Story = {
  parameters: {
    ...startSnippet({ start: `{}` }),
    docs: { story: { inline: false, iframeHeight: 520 }, source: { code: "<DatasetFlow />" } },
  },
  decorators: [
    (Story) => (
      <Box maxWidth="390px" borderWidth="1px" borderColor="border.muted">
        <Story />
      </Box>
    ),
  ],
  render: () => <DatasetFlow />,
};
