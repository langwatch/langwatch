import type { Meta, StoryObj } from "@storybook/react-vite";

import { SectionOverview } from "./section-overview.tsx";

const meta = {
  title: "Data display/Overview",
  parameters: {
    layout: "fullscreen",
    controls: { disable: true },
    usage: {
      use: "The section's cover: every component in it, with a preview and when to use it.",
    },
  },
  tags: ["!autodocs", "dev"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  render: (_, { globals }) => (
    <SectionOverview section="Data display" colorMode={globals.colorMode} />
  ),
};
