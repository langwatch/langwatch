import { chakra } from "@langwatch/design-system/primitives";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  LONG_NAME_AGENTS,
  ResourceCatalogue,
  type Agent,
  type ResourceCatalogueStart,
} from "./resource-catalogue.example.tsx";
import { resourceCatalogueSource } from "./resource-catalogue.source.ts";

const meta = {
  title: "Patterns/Resource catalogue",
  component: ResourceCatalogue,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    usage: {
      use: "Scanning a modest set of resources whose name and kind matter more than columns: agents, workflows, evaluators. Each opens a read-only detail, and a menu holds the other actions.",
      avoid:
        "Dozens of records to compare or sort: use a table, see Create, edit and delete. A tile that opens nothing: use a Card.",
    },
    docs: {
      story: { inline: false, iframeHeight: 720 },
      source: { code: resourceCatalogueSource, language: "tsx" },
      description: {
        component: [
          "**When to use it.** Six agents, a handful of workflows: a set small enough to see at once, where the reader finds a resource by its name and kind and not by sorting a column. There is no table, no paging and no view switch on purpose.",
          "",
          "**How it is built.** The design system owns every shape; the example owns the search, the type filter and the open detail; your application owns the data, the permissions and what Edit and View history open.",
          "",
          "| Part | Shape | What it owns |",
          "| --- | --- | --- |",
          "| The page | `ListPage` with its `toolbar` | Title, one muted line, New agent, search, the type chips, the count and Clear filters. Loading, failed, empty and no-results each have their own state. |",
          "| The grid | `CardGrid` | One column on a phone, two from a tablet and three on a desktop, every tile the same height. |",
          "| The tile | `ResourceTile` | Icon, name, two clamped lines, the type badge and when it changed. Its `opener` is a native `<button>` that stretches over the tile; the menu and badge sit above it. |",
          "| The menu | `Menu` with `MoreVerticalIcon` | Edit and View history. Opening it never opens the detail. |",
          "| The detail | `Drawer` | The agent's facts, read-only. Done closes it and focus returns to the tile. |",
          "| The states | `NoDataInfoBlock` through `ListPage` | Empty, no-results and failed each carry a docs page or a prompt for your coding agent, beside Try again or Clear filters. |",
          "",
          "**Why tiles.** Name, a description and a kind are what the reader scans, so each resource gets a surface of its own. A `Card` with an `opener` is the same idea for a tile whose body is richer than a description; do not mix the two in one grid.",
          "",
          "**Real screen.** The Agents page (`modules/agent/browser/src/ui/sections/agent-management-screen.tsx`, line 257, and its tile, `agent-card.tsx`, lines 36 and 76). The example keeps three of the six agent types, leaves out the test, replicate, push and voice menu choices that need the application, and draws Connected agents in the same grid; the real page draws them in a section of their own.",
          "",
          "**Copy it.** The source under the first example is the whole file: imports, types, fixtures and state. Inside the application's design system provider it runs as it is. Replace `SEED_AGENTS` with your data, pass `onRequest` to open your editor and history, and delete the `start` prop, which only opens the stories in a given state.",
          "",
          "See also [Using them together](?path=/docs/patterns-using-them-together--docs) for the whole set.",
        ].join("\n"),
      },
    },
  },
} satisfies Meta<typeof ResourceCatalogue>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One short line in each story's code panel; the full file is under Default. */
function startSnippet({ start }: { start: string }): { docs: { source: { code: string } } } {
  return {
    docs: {
      source: {
        code: `// The whole file is shown under Default.\n<ResourceCatalogue start={${start}} />`,
      },
    },
  };
}

function catalogue({ start, agents }: { start?: ResourceCatalogueStart; agents?: Agent[] }) {
  return () => <ResourceCatalogue start={start} agents={agents} />;
}

/** Six agents of three types: open one, filter by type, or use a tile's menu. */
export const Default: Story = {
  render: () => <ResourceCatalogue />,
};

/** The HTTP chip is selected: only HTTP agents show, the other chips keep their counts. */
export const Filtered: Story = {
  parameters: startSnippet({ start: `{ kind: "http" }` }),
  render: catalogue({ start: { kind: "http" } }),
};

/** A long name is cut at the tile's edge and read in full in the detail drawer. */
export const LongNames: Story = {
  parameters: startSnippet({ start: `{}` }),
  render: catalogue({ agents: LONG_NAME_AGENTS }),
};

/** The agents are loading: the search waits and the page keeps its header. */
export const Loading: Story = {
  parameters: startSnippet({ start: `{ view: "loading" }` }),
  render: catalogue({ start: { view: "loading" } }),
};

/** No agents yet: read about them, or paste a prompt into your coding agent. */
export const Empty: Story = {
  parameters: startSnippet({ start: `{}` }),
  render: catalogue({ agents: [] }),
};

/** Agents exist, but none match: clear the filters, or read about the types. */
export const NoResults: Story = {
  parameters: startSnippet({ start: `{ query: "invoices", kind: "http" }` }),
  render: catalogue({ start: { query: "invoices", kind: "http" } }),
};

/** The agents service did not answer: try again, or read the troubleshooting page. */
export const Failed: Story = {
  parameters: startSnippet({ start: `{ view: "failed" }` }),
  render: catalogue({ start: { view: "failed" } }),
};

/** An agent's read-only detail: Done closes it, and focus returns to the tile. */
export const DetailOpen: Story = {
  parameters: startSnippet({ start: `{ openId: 1 }` }),
  render: catalogue({ start: { openId: 1 } }),
};

const Frame = chakra("iframe");

/** At 390 pixels the tiles stack in one column and the menu stays a full-size target. */
export const Narrow: Story = {
  parameters: {
    docs: {
      story: { inline: false, iframeHeight: 880 },
      source: { code: "<ResourceCatalogue /> // shown at a 390 pixel wide viewport" },
    },
  },
  render: (_args, { globals }) => (
    <Frame
      title="Resource catalogue at 390 pixels"
      src={`iframe.html?id=patterns-resource-catalogue--default&viewMode=story&globals=colorMode:${String(
        globals["colorMode"] ?? "system",
      )}`}
      width="390px"
      height="844px"
      maxWidth="full"
      borderWidth="1px"
      borderColor="border.muted"
    />
  ),
};
