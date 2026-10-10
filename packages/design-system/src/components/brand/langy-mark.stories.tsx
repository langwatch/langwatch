import type { Meta, StoryObj } from "@storybook/react-vite";

import { LangyMark, LangyMarkGradientDefs } from "./langy-mark.tsx";

const meta = {
  title: "Brand/Langy mark",
  parameters: { usage: { use: "Langy's mark, the logo in the brand gradient." } },
  component: LangyMark,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <>
        <LangyMarkGradientDefs />
        <Story />
      </>
    ),
  ],
} satisfies Meta<typeof LangyMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Avatar size, as the Langy panel draws it. */
export const Default: Story = {};

export const Hero: Story = { args: { size: 48 } };
