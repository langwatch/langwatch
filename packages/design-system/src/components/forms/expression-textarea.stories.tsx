import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { ExpressionTextarea } from "./expression-textarea.tsx";

function Editable({
  initial,
  mark,
  disabled,
}: {
  initial: string;
  mark?: { at: number; end: number };
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ExpressionTextarea
      aria-label="Expression"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      mark={mark}
      disabled={disabled}
      rows={4}
      spellCheck={false}
      placeholder={'attributes["orchestrator"] == "web"'}
      maxWidth="420px"
    />
  );
}

const meta = {
  title: "Forms/Expression textarea",
  parameters: {
    usage: {
      use: "Writing a filter expression, such as a braid condition, coloured as it is typed.",
      avoid:
        "Free text or prose: use Textarea. A query with chips and suggestions: the trace search bar.",
    },
  },
  component: Editable,
  tags: ["autodocs"],
  args: { initial: 'attributes["orchestrator"] == "web" and Verified("orchestrator")' },
} satisfies Meta<typeof Editable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { initial: "" } };

/** A refused construct, underlined where it stands. */
export const Marked: Story = {
  args: { initial: 'attributes["k"] >= 3', mark: { at: 16, end: 18 } },
};

/** Long text wraps and scrolls; the colours stay on their characters. */
export const LongText: Story = {
  args: {
    initial: Array.from({ length: 6 }, (_, i) => `attributes["key_${i}"] == "value ${i}"`).join(
      " and\n",
    ),
  },
};

export const Disabled: Story = { args: { disabled: true } };
