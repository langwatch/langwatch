import { chakra } from "@langwatch/design-system/primitives";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  LONG_BODY,
  LONG_HEADERS,
  LongDrawer,
  type LongDrawerStart,
} from "./long-drawer.example.tsx";
import { longDrawerSource } from "./long-drawer.source.ts";

const meta = {
  title: "Patterns/Drawer with form",
  component: LongDrawer,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    usage: {
      use: "Editing one long record beside the page it belongs to: a pinned header and footer, a body that scrolls, and tabs for the parts of the form.",
      avoid:
        "A short form with a few fields (a Dialog is enough), or a guided setup with ordered steps: see Guided setup. Never a drawer opened inside another drawer.",
    },
    docs: {
      story: { inline: false, iframeHeight: 720 },
      source: { code: longDrawerSource, language: "tsx" },
      description: {
        component: [
          "**When to use it.** A record with more fields than fit in one screen, edited without losing the page behind it: an agent, a rule, an integration. The reader sees what they are editing, scrolls the body under a pinned header and footer, and never loses the Save button.",
          "",
          "**How it is built.** The design system owns every shape; the example owns the draft; your application owns the saving, the connection test and the data.",
          "",
          "| Part | Shape | What it owns |",
          "| --- | --- | --- |",
          '| The drawer | `Drawer` with `size="lg"`, `icon`, `subtitle` | The header with its X, the scrolling body and the glass header and footer edges. `busy` makes the X, Escape and every action wait. |',
          "| The pinned fields | `toolbar` | The method and URL stay in view under the title however far the body is scrolled. |",
          "| The body | `SettingsField`, `ContentTabs` | Label, hint and error for each field. Body, Auth, Headers and Test are views of one form; the draft lives above the tabs, so switching keeps every edit. |",
          "| The footer | `footer` descriptor | Cancel, Test connection as a quiet action on the left, and Save changes as the one primary. The drawer owns the form: Enter and Save submit it once. |",
          "| The notices | `Banner`, `Toaster` | A refused save is a banner in the body with a next step. A stored save is a toast. |",
          "| The example | `LongDrawer` | The draft, validation and where focus goes: the first invalid field when a submit is refused, the Edit agent button when the drawer closes. |",
          "",
          "**The code editor, on purpose.** The product's request body is a feature-owned code editor with variable completion. This example uses a plain `Textarea` in its place so it stays a design system example. Do not read it as a proposal to rewrite the editor.",
          "",
          "**Three kinds of not-available.** Saving is pending: the buttons wait and show progress. Test connection is disabled with a reason when there is no URL. Read-only hides Save changes and says who can change the agent. Cancel and the X close the drawer and discard the draft.",
          "",
          "**Real screen.** The HTTP agent editor (`modules/agent/browser/src/ui/sections/agent-http-editor-drawer.tsx`): the name, method and URL fields at line 68 and the footer at line 139, and its tabs (`agent-http-editor-tabs.tsx`, line 119). The example drops the variable mapping tab, the secret references and the live test messages.",
          "",
          "**Copy it.** The source under the first example is the whole file: imports, types, fixtures and state. Inside the application's design system provider it runs as it is. Replace `saveLocally` and `testLocally` with calls to your API, `SAVED_AGENT` with your data, and delete the `start` prop, which exists only to open the stories in a given state.",
          "",
          "See also [Using them together](?path=/docs/patterns-using-them-together--docs) for the whole set.",
        ].join("\n"),
      },
    },
  },
} satisfies Meta<typeof LongDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One short line in each story's code panel; the full file is under Default. */
function startSnippet({ start }: { start: string }) {
  return {
    docs: {
      source: {
        code: `// The whole file is shown under Default.\n<LongDrawer start={${start}} />`,
      },
    },
  };
}

function story({ start, snippet }: { start: LongDrawerStart; snippet: string }): Story {
  return { parameters: startSnippet({ start: snippet }), args: { start } };
}

/** The agent open for editing: change a field, switch tab and back, test the connection, save. */
export const Default: Story = {};

/** A long request body and fourteen headers: the body scrolls under the header and footer. */
export const LongBody: Story = story({
  snippet: `{ draft: { body: LONG_BODY, headers: LONG_HEADERS } }`,
  start: { draft: { body: LONG_BODY, headers: LONG_HEADERS } },
});

/** A URL without its scheme: said under the field, and focus goes there. */
export const InvalidUrl: Story = story({
  snippet: `{ draft: { url: "api.example.com/support/chat" }, problems: { url: "Enter a full URL, starting with https://" } }`,
  start: {
    draft: { url: "api.example.com/support/chat" },
    problems: { url: "Enter a full URL, starting with https://" },
  },
});

/** A save in flight: the buttons and fields wait, the X and Escape do nothing. */
export const Saving: Story = story({
  snippet: `{ draft: { name: "Support HTTP agent (EU)" }, saving: true }`,
  start: { draft: { name: "Support HTTP agent (EU)" }, saving: true },
});

/** A refused save keeps every edit and says so above the form; save again to retry. */
export const SaveFailed: Story = story({
  snippet: `{ draft: { name: "Support HTTP agent (EU)" }, failure: "The agent service did not answer." }`,
  start: {
    draft: { name: "Support HTTP agent (EU)" },
    failure: "The agent service did not answer.",
  },
});

/** A connection that cannot be reached: the Test tab says why and what to check. */
export const TestFailed: Story = story({
  snippet: `{ tab: "test", testFailure: "The request timed out after 30 seconds." }`,
  start: { tab: "test", testFailure: "The request timed out after 30 seconds." },
});

/** Someone who cannot change the agent reads it and runs a test; a banner says who can. */
export const ReadOnly: Story = story({ snippet: `{ readOnly: true }`, start: { readOnly: true } });

const Frame = chakra("iframe");

/** At 390 pixels the drawer takes the screen and the fields stack; the footer stays reachable. */
export const Narrow: Story = {
  parameters: {
    docs: {
      story: { inline: false, iframeHeight: 880 },
      source: { code: "<LongDrawer /> // shown at a 390 pixel wide viewport" },
    },
  },
  render: (_args, { globals }) => (
    <Frame
      title="Drawer with form at 390 pixels"
      src={`iframe.html?id=patterns-drawer-with-form--default&viewMode=story&globals=colorMode:${String(
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
