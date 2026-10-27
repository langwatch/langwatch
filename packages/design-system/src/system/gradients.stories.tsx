import { Badge, Box, Grid, HStack, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import "../components/brand/langy-theme.css";
import { AmbientGround } from "../components/brand/ambient-ground.tsx";
import { FullLogo } from "../components/brand/full-logo.tsx";
import {
  LangyMark,
  LangyMarkGradientDefs,
  LangyMeshLayer,
} from "../components/brand/langy-mark.tsx";
import { LogoIcon } from "../components/brand/logo-icon.tsx";

/**
 * The brand's surfaces, each drawn by the component or variable that owns it.
 * Nothing here is a new value: a gradient a screen needs is one of these.
 */
function Surface({
  name,
  source,
  children,
}: {
  name: string;
  source: string;
  children: ReactNode;
}) {
  return (
    <Stack gap={2}>
      <Box
        position="relative"
        height="10rem"
        borderRadius="lg"
        overflow="hidden"
        borderWidth="1px"
        borderColor="border.muted"
      >
        {children}
      </Box>
      <Text fontWeight="medium">{name}</Text>
      <Text fontFamily="mono" fontSize="xs" color="fg.muted">
        {source}
      </Text>
    </Stack>
  );
}

const meta = {
  title: "Foundations/Gradients and brand surfaces",
  parameters: {
    usage: {
      use: "Branded pages, onboarding and Langy: take the surface from its component (Ambient ground, Langy mark, the AI gradient variable).",
      avoid:
        "A new gradient written at a call site, or a brand surface behind a product screen. Product screens stay on `bg` and `bg.panel`.",
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gradients: Story = {
  render: () => (
    <Grid gap={6} templateColumns="repeat(auto-fill, minmax(18rem, 1fr))">
      <Surface name="Ambient ground" source="@langwatch/design-system/ambient-ground">
        <AmbientGround />
      </Surface>
      <Surface name="Langy AI gradient" source="var(--langy-ai-gradient) · langy-theme.css">
        <Box position="absolute" inset={0} backgroundImage="var(--langy-ai-gradient)" />
      </Surface>
      <Surface name="Langy mesh, drifting" source="LangyMeshLayer · langy-mark.tsx">
        <LangyMeshLayer active />
      </Surface>
    </Grid>
  ),
};

export const Marks: Story = {
  render: () => (
    <HStack gap={10} align="center">
      <LangyMarkGradientDefs />
      <FullLogo />
      <LogoIcon />
      <LangyMark size={40} />
    </HStack>
  ),
};

/** The accent is the brand orange; status colours are never decoration. */
export const BrandColours: Story = {
  render: () => (
    <HStack gap={4}>
      {["accent.solid", "accent.subtle", "logo.mark", "logo.face", "logo.wordmark"].map((token) => (
        <Stack key={token} gap={1.5} align="center">
          <Box
            boxSize={12}
            borderRadius="md"
            bg={token}
            borderWidth="1px"
            borderColor="border.muted"
          />
          <Text fontFamily="mono" fontSize="xs">
            {token}
          </Text>
        </Stack>
      ))}
    </HStack>
  ),
};

/** A solid badge wears quiet glass on its palette: the one sheen product screens carry. */
export const Glass: Story = {
  render: () => (
    <HStack gap={3}>
      {["accent", "green", "red", "blue", "purple", "gray"].map((palette) => (
        <Badge key={palette} variant="solid" colorPalette={palette}>
          {palette}
        </Badge>
      ))}
    </HStack>
  ),
};
