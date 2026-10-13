import { chakra } from "@langwatch/design-system/primitives";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  AutomationHistory,
  FIRES,
  GuidedSetup,
  type GuidedSetupStart,
} from "./guided-setup.example.tsx";
import { guidedSetupSource } from "./guided-setup.source.ts";

const meta = {
  title: "Patterns/Guided setup",
  component: GuidedSetup,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    usage: {
      use: "Several choices that depend on each other, each needing a look before anything is created: choose, then deliver, then review what you chose.",
      avoid:
        "One short form: use a Drawer with a form, or Create, edit and delete. A long edit with no order: use Drawer with form and its tabs.",
    },
    docs: {
      story: { inline: false, iframeHeight: 640 },
      source: { code: guidedSetupSource, language: "tsx" },
      description: {
        component: [
          "**When to use it.** An automation, an alert, an integration: anything where the second choice only makes sense after the first, and where the reader should see all of it together before it exists. The reader is never more than a click from an earlier answer.",
          "",
          "**How it is built.** The design system owns every shape; the example owns the local state and the order of the stages; your application owns the saving, the test send and the data.",
          "",
          "| Part | Shape | What it owns |",
          "| --- | --- | --- |",
          "| The page | `PageLayout` with `ResourceRow` | The list the new automation joins, and its New automation button. |",
          "| The drawer | `Drawer` with `ActionRow` through `footer` | Header, scroll body, and the footer: Cancel, a `Step 2 of 3` note, Back, Send test message and the primary button, which reads Continue, then Create automation. |",
          "| The fields | `SettingsField`, `Input`, `NativeSelect`, `RadioGroup` | Labels, hints and the error under a field. Continue with a missing answer says what is missing and focuses it. |",
          "| The review | `Card` with `Banner` | The actual choices, an Edit button for each, and the result of a test send. |",
          "| The rail | `StepRail` in the example | Numbered cards with a summary line, a tick once answered, `aria-current=step`, and a muted, disabled look for stages that cannot be opened yet. |",
          "| The history | `ActivityTimeline` with `LoadMore` | Earlier firings, newest first. Load more adds the next older page under the rows already there. |",
          "",
          "**The rail is a gap.** The design system has no step rail yet, so the example builds one from its pieces, as the automation screen does (`modules/automation/browser/src/features/authoring/ui/blocks/step-rail.tsx`). When a shared one lands, replace the local `StepRail` function and keep the descriptors it takes: id, label, summary, complete and reachable.",
          "",
          "**Order, on purpose.** A new automation walks the stages in order. A stage opens when it is the current one, or it was reached and every stage before it is answered. Editing a saved automation opens on Review and reaches all three; what it watches stays locked.",
          "",
          "**Real screen.** The automation drawer: the wizard (`modules/automation/browser/src/features/authoring/ui/sections/automation-wizard.tsx`, the order and the name above the rail at line 18, the rail at line 57), the rail (`step-rail.tsx`, line 31) and the history (`history-section.tsx`, appended pages at line 59, earlier entries at line 81). The example keeps one subject, one threshold and three destinations, and shows each firing on its own row where the product groups firings that share a time label.",
          "",
          "**Copy it.** The source under the first example is the whole file: imports, types, fixtures, state and the two stand-ins. Inside the application's design system provider it runs as it is. Replace `saveLocally` and `sendLocally` with calls to your API, `DESTINATIONS` with yours, and delete the `start` prop, which only opens the stories in a given state.",
          "",
          "See also [Using them together](?path=/docs/patterns-using-them-together--docs) for the whole set.",
        ].join("\n"),
      },
    },
  },
} satisfies Meta<typeof GuidedSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One short line in each story's code panel; the full file is under Watch. */
function startSnippet({ start }: { start: string }): { docs: { source: { code: string } } } {
  return {
    docs: {
      source: {
        code: `// The whole file is shown under Watch.\n<GuidedSetup start={${start}} />`,
      },
    },
  };
}

const COMPLETE_WATCH = { threshold: "0.50" } as const;
const COMPLETE_ALL = { threshold: "0.50", destination: "slack-support" } as const;

function setup({ start }: { start: GuidedSetupStart }) {
  return () => <GuidedSetup start={start} />;
}

/** The first stage: what to watch and the threshold. Continue waits until the threshold is set. */
export const Watch: Story = {
  render: setup({ start: { step: "watch" } }),
};

/** The second stage: where alerts go. Watch shows a tick and its answer in the rail. */
export const Delivery: Story = {
  parameters: startSnippet({ start: `{ step: "delivery", draft: { threshold: "0.50" } }` }),
  render: setup({ start: { step: "delivery", draft: COMPLETE_WATCH } }),
};

/** The last stage: the choices as they stand, an Edit for each, a test send and Create. */
export const Review: Story = {
  parameters: startSnippet({
    start: `{ step: "review", draft: { threshold: "0.50", destination: "slack-support" } }`,
  }),
  render: setup({ start: { step: "review", draft: COMPLETE_ALL } }),
};

/** Continue with no threshold says so under the field and puts focus there. */
export const InvalidWatch: Story = {
  parameters: startSnippet({
    start: `{ step: "watch", problems: { threshold: "Enter a threshold above 0 to continue." } }`,
  }),
  render: setup({
    start: {
      step: "watch",
      problems: { threshold: "Enter a threshold above 0 to continue." },
    },
  }),
};

/** No destination exists: Continue is off, the reason is shown and two ways forward are given. */
export const NoDestinations: Story = {
  parameters: startSnippet({ start: `{ step: "delivery" } /* with destinations={[]} */` }),
  render: () => (
    <GuidedSetup destinations={[]} start={{ step: "delivery", draft: COMPLETE_WATCH }} />
  ),
};

/** Create in flight: the button shows progress and every field and action waits. */
export const Saving: Story = {
  parameters: startSnippet({ start: `{ step: "review", saving: true, draft }` }),
  render: setup({ start: { step: "review", draft: COMPLETE_ALL, saving: true } }),
};

/** A refused save keeps every answer and says so above the fields; save again to retry. */
export const SaveFailed: Story = {
  parameters: startSnippet({
    start: `{ step: "review", failure: "The automation service did not answer.", draft }`,
  }),
  render: setup({
    start: {
      step: "review",
      draft: COMPLETE_ALL,
      failure: "The automation service did not answer.",
    },
  }),
};

/** A saved automation opens on Review; each stage can be revisited and its subject is locked. */
export const EditExisting: Story = {
  parameters: startSnippet({ start: `{ mode: "edit" }` }),
  render: setup({ start: { mode: "edit" } }),
};

const Frame = chakra("iframe");

/** At 390 pixels the rail keeps its three cards, the footer stays in reach and fields stack. */
export const Narrow: Story = {
  parameters: {
    docs: {
      story: { inline: false, iframeHeight: 880 },
      source: { code: "<GuidedSetup /> // shown at a 390 pixel wide viewport" },
    },
  },
  render: (_args, { globals }) => (
    <Frame
      title="Guided setup at 390 pixels"
      src={`iframe.html?id=patterns-guided-setup--delivery&viewMode=story&globals=colorMode:${String(
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

/** The first page of earlier firings, newest first, with Load more under them. */
export const History: Story = {
  parameters: { docs: { source: { code: "<AutomationHistory />" } } },
  render: () => <AutomationHistory />,
};

/** The next older page is loading: the button shows progress and the rows stay where they are. */
export const HistoryLoadingMore: Story = {
  parameters: { docs: { source: { code: "<AutomationHistory start={{ loadingMore: true }} />" } } },
  render: () => <AutomationHistory start={{ loadingMore: true }} />,
};

/** Every firing is shown: the count reads all of them and the action is gone. */
export const HistoryEnd: Story = {
  parameters: {
    docs: { source: { code: "<AutomationHistory start={{ loaded: FIRES.length }} />" } },
  },
  render: () => <AutomationHistory start={{ loaded: FIRES.length }} />,
};
