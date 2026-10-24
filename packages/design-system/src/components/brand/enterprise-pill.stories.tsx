import type { Meta, StoryObj } from "@storybook/react-vite";

import { EnterprisePill } from "./enterprise-pill.tsx";

const meta = {
  title: "Brand/Enterprise pill",
  parameters: {
    usage: {
      use: "Beside a sidebar entry or a page title the Enterprise plan gates. See docs/feature-branding.md.",
      avoid:
        "A refusal or an error; the plan comparison table; a control the plan already carries.",
    },
  },
  component: EnterprisePill,
  tags: ["autodocs"],
} satisfies Meta<typeof EnterprisePill>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The same quiet chip wherever it sits. */
export const Default: Story = {};
