import { Flex, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { FeatureMark } from "./feature-mark.tsx";

const meta = {
  title: "Brand/Feature mark",
  parameters: {
    usage: {
      use: "A branded feature's mark: its page header, empty state, navigation entry or Enterprise pill. See docs/feature-branding.md.",
      avoid:
        "An image file or a copied SVG with its own colours; the LangWatch logo's place in the app chrome.",
    },
  },
  component: FeatureMark,
  tags: ["autodocs"],
  args: { feature: "braids", size: 40 },
} satisfies Meta<typeof FeatureMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Follows the colour mode: the lead strand in the app orange, the others in slate. */
export const Default: Story = {};

/** One colour, in the surrounding text colour, beside other one-colour marks. */
export const Mono: Story = { args: { variant: "mono" } };

/** The optical small master, drawn automatically at 24px and below. */
export const Small: Story = { args: { size: 20 } };

export const Dark: Story = { args: { forceColorMode: "dark" } };

/** Every size from navigation to hero; the master switches at 24px. */
export const Sizes: Story = {
  render: (args) => (
    <Stack gap="4">
      {(["colour", "mono"] as const).map((variant) => (
        <Flex key={variant} align="end" gap="6" color="fg">
          {[16, 20, 24, 32, 48, 72].map((size) => (
            <Stack key={size} align="center" gap="1">
              <FeatureMark {...args} size={size} variant={variant} />
              <Text fontSize="xs" color="fg.muted">
                {size}
              </Text>
            </Stack>
          ))}
        </Flex>
      ))}
    </Stack>
  ),
};
