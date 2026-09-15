import type { Meta, StoryObj } from "@storybook/react-vite";
import { GenerateApiSnippetButton } from "./generate-api-snippet-button.tsx";

const meta = {
  title: "Components/Generate API snippet button",
  component: GenerateApiSnippetButton,
  tags: ["autodocs"],
  args: { hasHandle: true },
} satisfies Meta<typeof GenerateApiSnippetButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The prompt is saved, so there is a handle to call it by. */
export const Default: Story = {};

/** Nothing to call yet: the button is disabled and the tooltip says why. */
export const WithoutAHandle: Story = {
  args: { hasHandle: false },
};
