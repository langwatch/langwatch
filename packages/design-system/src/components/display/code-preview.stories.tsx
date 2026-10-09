import type { Meta, StoryObj } from "@storybook/react-vite";

import { CodePreview } from "./code-preview.tsx";

const meta = {
  title: "Components/Code preview",
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
