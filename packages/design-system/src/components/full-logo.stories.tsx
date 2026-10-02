import { HStack, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DarkMode, LightMode } from "../color-mode/index.tsx";
import { FullLogo } from "./full-logo.tsx";
import { LogoIcon } from "./logo-icon.tsx";

const meta = {
  title: "Foundations/Full logo",
  component: FullLogo,
  tags: ["autodocs"],
} satisfies Meta<typeof FullLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every size on one surface, pinned to a mode by `LightMode` or `DarkMode`. */
function Surface({ mode }: { mode: "light" | "dark" }) {
  const Mode = mode === "light" ? LightMode : DarkMode;
  return (
    <Mode>
      <Stack gap="4" align="start" padding="4" borderRadius="lg" bg="bg.panel">
        <HStack gap="4" align="end">
          {[16, 20, 24, 30, 52].map((height) => (
            <LogoIcon key={height} height={height} />
          ))}
        </HStack>
        <FullLogo width={112} height={27.5} />
        <FullLogo />
        <FullLogo width={240} height={59} />
        <Text textStyle="xs" color="fg.muted">
          {mode}
        </Text>
      </Stack>
    </Mode>
  );
}

/** Follows the colour mode of the surface it sits on. */
export const Default: Story = {};

export const Light: Story = { render: () => <Surface mode="light" /> };

export const Dark: Story = { render: () => <Surface mode="dark" /> };

/** The rail, tab and caption sizes, where the lines thicken. */
export const Small: Story = {
  render: () => (
    <HStack gap="4" align="end">
      <LogoIcon height={20} />
      <LogoIcon height={24} />
      <LogoIcon height={30} />
      <FullLogo width={100} height={25} />
    </HStack>
  ),
};

/** Standalone pages: sign-in, the loading screen, a shared trace. */
export const Large: Story = {
  render: () => (
    <Stack gap="4" align="start">
      <FullLogo width={186} height={45.6} />
      <FullLogo width={240} height={59} />
      <LogoIcon height={64} />
    </Stack>
  ),
};
