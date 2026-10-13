import { Box } from "@langwatch/design-system/primitives";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  ApiKeyFlow,
  FAKE_TOKEN,
  SEED_KEYS,
  type ApiKeyFlowStart,
} from "./api-key-flow.example.tsx";

/** The example's own text, so the docs show exactly the file that renders. */
const files = import.meta.glob("./api-key-flow.example.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});
const apiKeyFlowSource = Object.values(files).map(String).join("");

const MISSING_NOTHING = { name: "Release pipeline", expiry: "30", attempted: true } as const;

const meta = {
  title: "Patterns/API key create and reveal",
  component: ApiKeyFlow,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    usage: {
      use: "Creating a credential whose secret is shown once: collect the choices in a drawer, then reveal the secret in a dialog that explains it cannot be seen again.",
      avoid:
        "A secret the reader can always look up again, or one handed over without a choice to make: show it on its own page or send it by the channel that owns it.",
    },
    docs: {
      story: { inline: false, iframeHeight: 640 },
      source: { code: apiKeyFlowSource, language: "tsx" },
      description: {
        component: [
          "**When to use it.** API keys, tokens and any credential created once and then known only by a prefix. The list stays behind the form, and the secret exists in one place, on the page, until the reader presses Done.",
          "",
          "**How it is built.** The design system owns every shape; the example owns the short-lived token; your application owns the saving, the clipboard and what a caller may grant.",
          "",
          "| Part | Shape | What it owns |",
          "| --- | --- | --- |",
          "| The page | `ListPage` with `ListTable` | Title, description and the table. The secret key column holds the prefix only. Empty carries a docs link and a prompt for a coding agent. |",
          "| The form | `Drawer` with `SettingsField` | Key type, name, description, `ScopeChipPicker`, permissions and expiry. Cancel is kept. Create names every missing choice and focuses the first. |",
          "| The reveal | `Dialog` | One Done and no Cancel (`cancelLabel={null}`), no close on an outside click, focus on Copy API key. It opens only after the drawer has closed. |",
          "| The snippets | `ContentTabs` with `SnippetPreview` | `.env` and Bearer. The screen shows a mask, the copy button writes the real value, and the copy seam is yours. |",
          "| The key | `Card` with `InlineCode` | The key's name and its masked value, with Show key and one Copy API key button. |",
          "| The example | `ApiKeyFlow` | The draft, validation, focus, the token held until Done, and the copy outcome. |",
          "",
          "**Copying, honestly.** Copy API key says Copied only after the clipboard took the key. If the browser refuses, the dialog says so in an error banner and offers Select the key, which shows the value and selects it for a manual copy. No notice claims a copy that did not happen, and no notice, attribute or story control carries the value.",
          "",
          "**Secret, on purpose.** Done, Escape and the X all clear the token. Reopening the form or the list never recovers it. The value in these stories is a fixed example, `" +
            FAKE_TOKEN +
            "`, that opens nothing.",
          "",
          "**Left out on purpose.** Custom expiry dates, the member picker and the permission resolver are the product's. Permissions here are a fixed list of four; the example does not compute what a caller may grant. Edit and revoke are not part of this pattern, so the table has no selection and no row actions.",
          "",
          "**Real screen.** The create drawer (`modules/api-key/browser/src/ui/sections/create-api-key-drawer.tsx`, the required choices at line 141) and the reveal (`token-created-dialog.tsx`, the dialog at line 109, the masking and copy at line 167), joined by the list screen (`api-keys-screen.tsx`, the token received at line 374 and cleared at line 540).",
          "",
          "**Copy it.** The source under the first example is the whole file: imports, types, fixtures, state and the stand-ins `createLocally` and `writeToClipboard`. Inside the application's design system provider it runs as it is. Replace the stand-ins with your API and your clipboard seam, `SEED_KEYS` with your data, and delete the `start` prop, which exists only to open the stories in a given state.",
          "",
          "See also [Using them together](?path=/docs/patterns-using-them-together--docs) for the whole set.",
        ].join("\n"),
      },
    },
  },
} satisfies Meta<typeof ApiKeyFlow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One short line in each story's code panel; the full file is under Default. */
function startSnippet({ start }: { start: string }): { docs: { source: { code: string } } } {
  return {
    docs: {
      source: {
        code: `// The whole file is shown under Default.\n<ApiKeyFlow start={${start}} />`,
      },
    },
  };
}

function flow({ start }: { start?: ApiKeyFlowStart }) {
  return () => <ApiKeyFlow start={start} />;
}

/** Two keys, each showing its prefix only. Create new secret key opens the form. */
export const Default: Story = {
  render: () => <ApiKeyFlow />,
};

/** The form as a reader first sees it: personal key, the current project, All permissions. */
export const CreateOpen: Story = {
  parameters: startSnippet({ start: `{ form: {} }` }),
  render: flow({ start: { form: {} } }),
};

/** No name: it is said under the field and focus goes there. */
export const MissingName: Story = {
  parameters: startSnippet({ start: `{ form: { name: "", expiry: "never", attempted: true } }` }),
  render: flow({ start: { form: { name: "", expiry: "never", attempted: true } } }),
};

/** No expiry chosen: the reader must choose a date or No expiration. */
export const ExpiryUnchosen: Story = {
  parameters: startSnippet({ start: `{ form: { name: "Release pipeline", attempted: true } }` }),
  render: flow({ start: { form: { name: "Release pipeline", attempted: true } } }),
};

/** The scope was cleared: the form asks where the key can be used. */
export const NoScope: Story = {
  parameters: startSnippet({ start: `{ form: { …, scopes: [], attempted: true } }` }),
  render: flow({
    start: { form: { name: "Release pipeline", expiry: "never", scopes: [], attempted: true } },
  }),
};

/** A create in flight: the button shows progress and the form waits. */
export const Creating: Story = {
  parameters: startSnippet({ start: `{ form: { …, pending: true } }` }),
  render: flow({ start: { form: { ...MISSING_NOTHING, pending: true } } }),
};

/** A refused create keeps the draft and says so above the fields; create again to retry. */
export const CreateFailed: Story = {
  parameters: startSnippet({
    start: `{ form: { …, failure: "The key service did not answer." } }`,
  }),
  render: flow({
    start: { form: { ...MISSING_NOTHING, failure: "The key service did not answer." } },
  }),
};

/** The reveal for a key that reaches several projects: choose which one the snippet names. */
export const Reveal: Story = {
  parameters: startSnippet({ start: `{ reveal: {} }` }),
  render: flow({ start: { reveal: {} } }),
};

/** A key that reaches one project names it outright, with nothing to choose. */
export const RevealOneProject: Story = {
  parameters: startSnippet({
    start: `{ reveal: { scopes: [{ scopeType: "PROJECT", scopeId: "proj-support" }] } }`,
  }),
  render: flow({
    start: { reveal: { scopes: [{ scopeType: "PROJECT", scopeId: "proj-support" }] } },
  }),
};

/** A key that reaches no project has no project ID to fill in; the key can still be copied. */
export const RevealNoProject: Story = {
  parameters: startSnippet({
    start: `{ reveal: { scopes: [{ scopeType: "TEAM", scopeId: "team-research" }] } }`,
  }),
  render: flow({
    start: { reveal: { scopes: [{ scopeType: "TEAM", scopeId: "team-research" }] } },
  }),
};

/** After a successful copy the button reads Copied, then goes back after two seconds. */
export const Copied: Story = {
  parameters: startSnippet({ start: `{ reveal: { copied: true } }` }),
  render: flow({ start: { reveal: { copied: true } } }),
};

/** The browser refused the copy: an error, and Select the key to copy it by hand. */
export const CopyFailed: Story = {
  parameters: startSnippet({ start: `{ reveal: { copyFailed: true } }` }),
  render: flow({ start: { reveal: { copyFailed: true } } }),
};

/** After Done the list holds the new key's prefix and nothing else of it. */
export const Closed: Story = {
  parameters: startSnippet({ start: `{ keys: [...SEED_KEYS, newKey] }` }),
  render: flow({
    start: {
      keys: [
        ...SEED_KEYS,
        {
          id: 3,
          name: "Release pipeline",
          prefix: FAKE_TOKEN.split("_")[0] + "…",
          keyType: "service",
          scope: "Acme (organisation)",
          created: "11 Oct 2026",
          lastUsed: "Never used",
        },
      ],
    },
  }),
};

/** No keys: a way to read about them and a prompt for a coding agent. */
export const Empty: Story = {
  parameters: startSnippet({ start: `{ keys: [] }` }),
  render: flow({ start: { keys: [] } }),
};

/** At 390 pixels the table scrolls inside its own region and the header action stays in reach. */
export const Narrow: Story = {
  parameters: {
    ...startSnippet({ start: `{}` }),
    docs: { story: { inline: false, iframeHeight: 520 }, source: { code: "<ApiKeyFlow />" } },
  },
  decorators: [
    (Story) => (
      <Box maxWidth="390px" borderWidth="1px" borderColor="border.muted">
        <Story />
      </Box>
    ),
  ],
  render: () => <ApiKeyFlow />,
};
