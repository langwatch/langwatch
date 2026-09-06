import { HStack, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FullLogo } from "./full-logo.tsx";

const meta = {
  title: "Foundations/Full logo",
  component: FullLogo,
  tags: ["autodocs"],
} satisfies Meta<typeof FullLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Follows the colour mode of the surface it sits on. */
export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <Stack gap="4" align="start">
      <FullLogo width={100} height={25} />
      <FullLogo />
      <FullLogo width={240} height={59} />
    </Stack>
  ),
};

/** Both cuts at once, for a surface that pins its own background. */
export const BothColourModes: Story = {
  render: () => (
    <HStack gap="6" align="center" wrap="wrap">
      <Stack gap="2" bg="white" padding="4" borderRadius="lg">
        <FullLogo forceColorMode="light" />
        <Text textStyle="xs" color="black">
          forceColorMode="light"
        </Text>
      </Stack>
      <Stack gap="2" bg="zinc.900" padding="4" borderRadius="lg">
        <FullLogo forceColorMode="dark" />
        <Text textStyle="xs" color="white">
          forceColorMode="dark"
        </Text>
      </Stack>
    </HStack>
  ),
};
