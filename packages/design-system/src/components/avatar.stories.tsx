import { HStack, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "./avatar.tsx";

const meta = {
  title: "Primitives/Avatar",
  component: Avatar.Root,
  tags: ["autodocs"],
  args: { colorPalette: "orange" },
  render: (args) => (
    <Avatar.Root {...args}>
      <Avatar.Fallback name="Alex Forbes-Reed" />
    </Avatar.Root>
  ),
} satisfies Meta<typeof Avatar.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithImage: Story = {
  render: (args) => (
    <Avatar.Root {...args}>
      <Avatar.Fallback name="Alex Forbes-Reed" />
      <Avatar.Image src="https://avatars.githubusercontent.com/u/1?v=4" alt="" />
    </Avatar.Root>
  ),
};

/** A name outside the basic plane still yields a whole character. */
export const EmojiName: Story = {
  render: (args) => (
    <HStack gap="3">
      <Avatar.Root {...args}>
        <Avatar.Fallback name="🚩 Langy" />
      </Avatar.Root>
      <Avatar.Root {...args}>
        <Avatar.Fallback name="Zoë Ó Súilleabháin" />
      </Avatar.Root>
    </HStack>
  ),
};

/** No name at all falls through to the generic icon rather than an empty bubble. */
export const NoName: Story = {
  render: (args) => (
    <Avatar.Root {...args}>
      <Avatar.Fallback name="" />
    </Avatar.Root>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <HStack gap="3" align="center">
      {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
        <Avatar.Root key={size} {...args} size={size}>
          <Avatar.Fallback name="Alex Forbes-Reed" />
        </Avatar.Root>
      ))}
    </HStack>
  ),
};

export const Variants: Story = {
  render: (args) => (
    <Stack gap="3">
      {(["solid", "subtle", "outline"] as const).map((variant) => (
        <HStack key={variant} gap="3">
          <Avatar.Root {...args} variant={variant}>
            <Avatar.Fallback name="Alex Forbes-Reed" />
          </Avatar.Root>
          <Text textStyle="sm" color="fg.muted">
            {variant}
          </Text>
        </HStack>
      ))}
    </Stack>
  ),
};
