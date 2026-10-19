import type { Meta, StoryObj } from "@storybook/react-vite";

import { CodePreview, SnippetPreview } from "./code-preview.tsx";

const meta = {
  title: "Data display/Code preview",
  parameters: {
    usage: {
      use: "A read-only snippet the reader may copy, highlighted, with a title bar. A setup snippet that carries a key is `SnippetPreview`: masked until revealed, copied unmasked.",
      avoid:
        "A word, key or path in a sentence: use Inline code. Never a module's own copy of either.",
    },
  },
  component: CodePreview,
  tags: ["autodocs"],
  args: {
    filename: "example.py",
    language: "python",
    code: 'import langwatch\n\nlangwatch.setup()\nprint("hello")',
  },
} satisfies Meta<typeof CodePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Shell: Story = {
  args: { filename: "terminal", language: "bash", code: 'curl -X POST "$LANGWATCH_ENDPOINT"' },
};

export const LineNumbers: Story = {
  args: {
    filename: "app.ts",
    language: "typescript",
    lineNumbers: true,
    code: 'import { setup } from "langwatch";\n\nsetup({ apiKey: process.env.LANGWATCH_API_KEY });\n\nexport const ready = true;',
  },
};

const TABBED =
  'class Code:\n\tdef __call__(self, input: str = None):\n\t\treturn {"output": {"accepted": True, "count": 2, "rows": [input]}}';

/** Tabs read four wide; a long line wraps under its own indent, never back at column 0. */
export const CompactWrapped: Story = {
  args: { filename: "code.py", language: "python", compact: true, lineNumbers: true, code: TABBED },
  decorators: [(Story) => <div style={{ maxWidth: 460 }}>{Story()}</div>],
};

const DIFF = `@@ -1,5 +1,6 @@
 import langwatch
 
-langwatch.setup()
+langwatch.setup(api_key=os.environ["LANGWATCH_API_KEY"])
+langwatch.trace(name="checkout")
 print("hello")`;

/** A unified diff: a +/- column, tinted lines, the code still highlighted as Python. */
export const Diff: Story = {
  args: { filename: "example.py", language: "python", diff: true, code: DIFF },
};

/** A diff with old and new line numbers side by side. */
export const DiffWithLineNumbers: Story = {
  args: { filename: "example.py", language: "python", diff: true, lineNumbers: true, code: DIFF },
};

const SECRET = "sk-lw-9f8e7d6c5b4a3210";
const ENV = `LANGWATCH_API_KEY=${SECRET}\nLANGWATCH_ENDPOINT=https://app.langwatch.ai`;

/** A setup snippet carrying a key: masked, revealed by the eye, always copied unmasked. */
export const SnippetWithSecret: Story = {
  render: () => (
    <SnippetPreview
      code={ENV}
      filename=".env"
      codeLanguage="ini"
      sensitiveValue={SECRET}
      enableVisibilityToggle
      copyText={ENV}
    />
  ),
};

export const SnippetWithPromptAndHighlight: Story = {
  render: () => (
    <SnippetPreview
      code={
        "import langwatch\n\nlangwatch.setup()\n\n@langwatch.trace()\ndef answer(question):\n    ..."
      }
      filename="main.py"
      codeLanguage="python"
      highlightLines={[3]}
      llmPrompt="Instrument this Python service with LangWatch."
    />
  ),
};

/** A placeholder key: no actions, so nothing copies into a command that would fail. */
export const SnippetWithoutActions: Story = {
  render: () => (
    <SnippetPreview
      code="export LANGWATCH_API_KEY=sk-lw-xxxxx"
      filename="terminal"
      codeLanguage="bash"
      disableActions
    />
  ),
};

export const SnippetCappedHeight: Story = {
  render: () => (
    <SnippetPreview
      code={Array.from({ length: 40 }, (_, line) => `echo "line ${line + 1}"`).join("\n")}
      filename="install.sh"
      codeLanguage="bash"
      maxHeight="12rem"
    />
  ),
};
