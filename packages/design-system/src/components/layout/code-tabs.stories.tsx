import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { CodeTabs, type CodeTabItem } from "./code-tabs.tsx";

type Language = "python" | "typescript" | "curl";

const ITEMS: CodeTabItem<Language>[] = [
  {
    value: "python",
    label: "Python",
    language: "python",
    code: 'import langwatch\n\nlangwatch.setup()\n\n@langwatch.trace()\ndef answer(question):\n    return "ok"',
    highlightLines: [3],
  },
  {
    value: "typescript",
    label: "TypeScript",
    language: "typescript",
    code: 'import { LangWatch } from "langwatch";\n\nconst langwatch = new LangWatch();\nawait langwatch.trace({ name: "answer" });',
  },
  {
    value: "curl",
    label: "curl",
    language: "bash",
    code: 'curl https://app.langwatch.ai/api/trace \\\n  -H "Authorization: Bearer $LANGWATCH_API_KEY"',
  },
];

function Demo() {
  const [value, setValue] = useState<Language>("python");
  return (
    <CodeTabs<Language>
      label="Snippet language"
      value={value}
      onValueChange={(next) => setValue(next.value)}
      items={ITEMS}
    />
  );
}

const meta = {
  title: "Data display/Code tabs",
  component: CodeTabs,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "One code window whose header carries the language tabs and the copy action, over one shared highlighted body. The highlighter and languages load inside the design system.",
      avoid:
        "A single snippet that carries a secret: SnippetPreview. Ordinary content tabs: Content tabs.",
    },
  },
  args: { value: "python", onValueChange: () => undefined, items: [], label: "Snippet language" },
} satisfies Meta<typeof CodeTabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Demo /> };
export const Narrow: Story = {
  render: () => (
    <Box maxWidth="320px">
      <Demo />
    </Box>
  ),
};
