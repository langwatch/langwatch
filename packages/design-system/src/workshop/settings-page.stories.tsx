import { chakra } from "@langwatch/design-system/primitives";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { SettingsForm, type SettingsFormStart } from "./settings-form.example.tsx";
import { settingsFormSource } from "./settings-form.source.ts";

type Outcome = "saves" | "is refused";

/** Long enough to see Saving before the answer. */
const SERVICE_DELAY_MS = 600;

/** Storybook's controls decide what the stand-in services answer; the example has none of this. */
function Demo({
  saveOutcome,
  switchOutcome,
  start,
}: {
  saveOutcome: Outcome;
  switchOutcome: Outcome;
  start?: SettingsFormStart;
}) {
  const answer = (outcome: Outcome) =>
    new Promise<void>((resolve, reject) =>
      setTimeout(
        () =>
          outcome === "saves"
            ? resolve()
            : reject(new Error("The organization service did not answer.")),
        SERVICE_DELAY_MS,
      ),
    );
  return (
    <SettingsForm
      save={() => answer(saveOutcome)}
      savePresence={() => answer(switchOutcome)}
      start={start}
    />
  );
}

const meta = {
  title: "Patterns/Settings page",
  component: Demo,
  tags: ["autodocs"],
  args: { saveOutcome: "saves", switchOutcome: "saves" },
  argTypes: {
    saveOutcome: {
      name: "Save changes",
      description: "What the stand-in service answers when Save changes is pressed.",
      control: "inline-radio",
      options: ["saves", "is refused"],
    },
    switchOutcome: {
      name: "Live presence",
      description: "What the stand-in service answers when the switch is flipped.",
      control: "inline-radio",
      options: ["saves", "is refused"],
    },
    start: { table: { disable: true } },
  },
  parameters: {
    layout: "fullscreen",
    usage: {
      use: "Editing durable settings where some are saved together with a Save changes button and others, switches, take effect the moment they are flipped.",
      avoid:
        "A form that only has switches (no Save button at all), or a record with many fields in a Drawer: see Create, edit and delete.",
    },
    docs: {
      story: { inline: false, iframeHeight: 720 },
      source: { code: settingsFormSource, language: "tsx" },
      description: {
        component: [
          "**When to use it.** Organization, project and personal settings: a few fields the reader edits and saves as one, next to switches that apply at once. Each kind says which it is: Save changes covers the fields, a switch shows its own Saving and Saved.",
          "",
          "**How it is built.** The design system owns every shape; the example owns the local state; your application owns the saving, who may edit and the data.",
          "",
          "| Part | Shape | What it owns |",
          "| --- | --- | --- |",
          "| The page | `PageLayout.Header` with `description`, `PageLayout.Container` | The compact title, the line under it, and the page width. |",
          "| The section | `SettingsSection` | The heading, the one line of what it is for, and the one Save changes action. |",
          "| The fields | `SettingsField` in a `SettingsFieldGroup` | Label, hint, error and the control's spacing. `SettingsFieldValue` shows a value the reader may not change; `IdText` shows the slug. |",
          '| The switch | `Switch` in a `SettingsField` with `controlAlign="end"` | The state of the setting. The example adds Saving, Saved and a rollback with the reason when it is refused. |',
          "| The notices | `Banner`, `Toaster` | A refused save is a banner above the section with a next step; a saved form is a toast. Read-only is a banner that says who can change it. |",
          "| The example | `SettingsForm` | The draft, the validation, the pending state and the rollback. |",
          "",
          "**Two ways to save, on purpose.** Name and Primary use are drafts: nothing is stored until Save changes, a refused save keeps what was typed, and the section shows Unsaved changes. Live presence is not a draft: flipping it stores it, so it has no Save button, shows Saving while it waits, and goes back with the reason if it is refused, without touching the name.",
          "",
          "**Read-only.** A person who cannot change a setting still reads it as text. There is no disabled Save changes: the banner says who can change it and where to read about roles.",
          "",
          "**Real screen.** Organization settings (`modules/project/browser/src/ui/sections/project-settings/project-settings-screen.tsx`): the page at line 358, the section and its Save changes at line 370, and the immediate Live presence switch at line 443. The example keeps those fields and drops the S3 storage, trace sharing and support contact fields, the project set-up dialogs and the permission checks.",
          "",
          "**Copy it.** The source under the first example is the whole file: imports, types, fixtures and state. Inside the application's design system provider it runs as it is. Replace `saveLocally` with calls to your API, `SAVED_VALUES` with your data, and delete the `start` prop, which exists only to open the stories in a given state. The Save changes and Live presence controls above the story decide what the stand-in services answer.",
          "",
          "See also [Using them together](?path=/docs/patterns-using-them-together--docs) for the whole set.",
        ].join("\n"),
      },
    },
  },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One short line in each story's code panel; the full file is under Default. */
function startSnippet({ start }: { start: string }) {
  return {
    docs: {
      source: {
        code: `// The whole file is shown under Default.\n<SettingsForm start={${start}} />`,
      },
    },
  };
}

/** Name and Primary use save together; Live presence saves the moment it is flipped. */
export const Default: Story = {};

/** A name typed but not saved: the section says Unsaved changes until Save changes is pressed. */
export const Dirty: Story = {
  parameters: startSnippet({ start: `{ name: "Support assistant platform" }` }),
  args: { start: { name: "Support assistant platform" } },
};

/** A missing name is said under the field, and focus goes there. */
export const Invalid: Story = {
  parameters: startSnippet({ start: `{ name: "", problem: "Name is required" }` }),
  args: { start: { name: "", problem: "Name is required" } },
};

/** A save in flight: the button shows progress and the fields wait. */
export const Saving: Story = {
  parameters: startSnippet({ start: `{ name: "Support assistant platform", saving: true }` }),
  args: { start: { name: "Support assistant platform", saving: true } },
};

/** A stored save: the notice says so and the section has nothing unsaved. */
export const Saved: Story = {
  parameters: startSnippet({ start: `{ saved: true }` }),
  args: { start: { saved: true } },
};

/** A refused save keeps what was typed and says so above the section; save again to retry. */
export const SaveFailed: Story = {
  parameters: startSnippet({
    start: `{ name: "Support assistant platform", failure: "The organization service did not answer." }`,
  }),
  args: {
    start: {
      name: "Support assistant platform",
      failure: "The organization service did not answer.",
    },
  },
};

/** A switch change in flight: the switch waits and says Saving. */
export const ImmediateSwitchSaving: Story = {
  parameters: startSnippet({ start: `{ switchSaving: true }` }),
  args: { start: { switchSaving: true } },
};

/** A refused switch change goes back to where it was and says why under the switch. */
export const ImmediateSwitchFailed: Story = {
  parameters: startSnippet({ start: `{ switchFailure: "Couldn't save. Try again." }` }),
  args: { start: { switchFailure: "Couldn't save. Try again." } },
};

/** Someone who cannot change the settings reads them, and a banner says who can. */
export const ReadOnly: Story = {
  parameters: startSnippet({ start: `{ readOnly: true }` }),
  args: { start: { readOnly: true } },
};

/** A long line under the title and a long name wrap and scroll without moving the controls. */
export const LongDescription: Story = {
  parameters: startSnippet({
    start: `{ description: "…a long sentence…", name: "…a long name…" }`,
  }),
  args: {
    start: {
      description:
        "How your organization is named, where members land after they sign in, which projects they see first, what they can share outside the organization, and which of these settings only an admin can change.",
      name: "Support assistant platform team for customer experience, billing questions and delivery escalations",
    },
  },
};

const Frame = chakra("iframe");

/** At 390 pixels the fields stack: label and hint above the control, the switch under its text. */
export const Narrow: Story = {
  parameters: {
    docs: {
      story: { inline: false, iframeHeight: 880 },
      source: { code: "<SettingsForm /> // shown at a 390 pixel wide viewport" },
    },
  },
  render: (_args, { globals }) => (
    <Frame
      title="Settings page at 390 pixels"
      src={`iframe.html?id=patterns-settings-page--default&viewMode=story&globals=colorMode:${String(
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
