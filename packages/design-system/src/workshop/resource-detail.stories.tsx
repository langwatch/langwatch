import { Box } from "@langwatch/design-system/primitives";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ResourceDetail, type ResourceDetailStart } from "./resource-detail.example.tsx";
import { resourceDetailSource } from "./resource-detail.source.ts";

const meta = {
  title: "Patterns/Resource detail",
  component: ResourceDetail,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    usage: {
      use: "Reading one resource and acting on it: its facts beside the main content, a few actions in the header, and a confirmation before anything that cannot be taken back.",
      avoid:
        "A record you edit in place beside its list: see Create, edit and delete. A page of many sections you navigate between: give each its own tab or route.",
    },
    docs: {
      story: { inline: false, iframeHeight: 720 },
      source: { code: resourceDetailSource, language: "tsx" },
      description: {
        component: [
          "**When to use it.** One virtual key, one agent, one dataset: anything with an identity, a status and a few things to do to it. The reader sees what it is, what state it is in and how to use it, without leaving the page.",
          "",
          "**How it is built.** The design system owns every shape; the example owns the local status and the open snippet language; your application owns the loading, the permissions, the routing and the actions.",
          "",
          "| Part | Shape | What it owns |",
          "| --- | --- | --- |",
          "| The header | `PageLayout.Header` with `PageLayout.HeaderButton` | Title, one muted description line, and the actions that change the key. At most one button is primary; here none is, as on the real screen. |",
          "| The facts | `Card` with `SummaryList` | Identity and Activity. An empty value reads as a dash. Activity's footer holds the links that leave the page. |",
          "| The main column | `CodeTabs`, `Card`, `ProviderScopeChips`, `ListTable` | The usage example, the scope and a small spend table. |",
          "| The confirmation | `ConfirmDialog` | Names the key. Disable is reversible and says so; Revoke is red and says it cannot be undone. |",
          "| The states | `SkeletonCard`, `NoDataInfoBlock` | Loading keeps the layout still. Missing and failed each carry a way back to the list. |",
          "| The example | `ResourceDetail` | The key, the open view, the open dialog and focus after a button disappears. |",
          "",
          "**The layout, on purpose.** The facts sit in a narrow right column from 62rem wide and above the main content below it, as the real page does. The snippet reads `$LANGWATCH_VK_SECRET` because the secret is shown once, when the key is created or rotated, and is never available here. The page has no Overview or Activity tabs; the only tabs are the snippet languages.",
          "",
          "**Real screen.** The virtual key detail page (`modules/gateway/browser/src/ui/sections/gateway/gateway-virtual-key.screen.tsx`: header and actions at line 457, the facts and main columns at line 480, scope and routing at line 498) and its snippet (`virtual-key-usage-snippet.tsx`, line 52). The example leaves out Edit, Rotate, the guardrail and configuration sections, moves Audit history and View traces from the header into the Activity card so a narrow header keeps its description, and adds a Name row so a name the header cuts stays readable.",
          "",
          "**Copy it.** The source under the first example is the whole file: imports, types, fixtures, state and the stand-in navigation. Inside the application's design system provider it runs as it is. Replace `SEED_KEY` with your data, the `setKey` calls with your API, and delete the `start` prop, which only opens the stories in a given state.",
          "",
          "See also [Using them together](?path=/docs/patterns-using-them-together--docs) for the whole set.",
        ].join("\n"),
      },
    },
  },
} satisfies Meta<typeof ResourceDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One short line in each story's code panel; the full file is under Default. */
function startSnippet({ start }: { start: string }): { docs: { source: { code: string } } } {
  return {
    docs: {
      source: {
        code: `// The whole file is shown under Default.\n<ResourceDetail start={${start}} />`,
      },
    },
  };
}

function detail({ start }: { start?: ResourceDetailStart }) {
  return () => <ResourceDetail start={start} />;
}

/** An active key: Disable it, switch the snippet language, revoke it. */
export const Default: Story = {
  render: () => <ResourceDetail />,
};

/** Disabled: the status says so and Enable replaces Disable; the key is otherwise whole. */
export const Disabled: Story = {
  parameters: startSnippet({ start: `{ key: { status: "disabled" } }` }),
  render: detail({ start: { key: { status: "disabled" } } }),
};

/** Disabling asks first, and says that Enable restores the key exactly. */
export const DisableConfirm: Story = {
  parameters: startSnippet({ start: `{ confirm: "disable" }` }),
  render: detail({ start: { confirm: "disable" } }),
};

/** Revoking names the key and says it cannot be undone; the confirm button is red. */
export const RevokeConfirm: Story = {
  parameters: startSnippet({ start: `{ confirm: "revoke" }` }),
  render: detail({ start: { confirm: "revoke" } }),
};

/** Revoked: only the audit history and the traces remain, and nothing can reactivate it. */
export const Revoked: Story = {
  parameters: startSnippet({ start: `{ key: { status: "revoked" } }` }),
  render: detail({ start: { key: { status: "revoked" } } }),
};

/** The key is loading: skeletons keep the layout, and the title says only what the page is. */
export const Loading: Story = {
  parameters: startSnippet({ start: `{ view: "loading" }` }),
  render: detail({ start: { view: "loading" } }),
};

/** The gateway did not answer: try again, or go back to the list. */
export const Failed: Story = {
  parameters: startSnippet({ start: `{ view: "failed" }` }),
  render: detail({ start: { view: "failed" } }),
};

/** No such key: the way back to the list is the next step. */
export const Missing: Story = {
  parameters: startSnippet({ start: `{ view: "missing" }` }),
  render: detail({ start: { view: "missing" } }),
};

/** A long name is cut in the header and read in full under Identity. */
export const LongName: Story = {
  parameters: startSnippet({ start: `{ key: { name: "…a very long name" } }` }),
  render: detail({
    start: {
      key: {
        name: "Production support assistant key for the customer-facing escalation workflow, rotated every quarter",
      },
    },
  }),
};

/** At 390 pixels the facts come first, in one column; the header actions scroll sideways. */
export const Narrow: Story = {
  parameters: {
    ...startSnippet({ start: `{}` }),
    docs: { story: { inline: false, iframeHeight: 640 }, source: { code: "<ResourceDetail />" } },
  },
  decorators: [
    (Story) => (
      <Box maxWidth="390px" borderWidth="1px" borderColor="border.muted">
        <Story />
      </Box>
    ),
  ],
  render: () => <ResourceDetail />,
};
