import { Box, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

const foundationColours = [
  "gray.50",
  "gray.100",
  "gray.400",
  "gray.700",
  "gray.900",
  "zinc.700",
  "zinc.800",
  "zinc.900",
  "orange.500",
  "blue.500",
  "green.500",
  "red.500",
  "purple.500",
] as const;

const semanticColours = [
  "bg",
  "bg.panel",
  "bg.muted",
  "bg.subtle",
  "fg",
  "fg.muted",
  "fg.subtle",
  "border",
  "border.muted",
  "border.subtle",
  "orange.solid",
  "green.solid",
  "red.solid",
] as const;

const accentColours = [
  "accent.solid",
  "accent.hover",
  "accent.subtle",
  "accent.muted",
  "accent.emphasized",
  "accent.fg",
] as const;

const statusColours = [
  "fg.error",
  "bg.error",
  "border.error",
  "fg.success",
  "bg.success",
  "border.success",
  "fg.warning",
  "bg.warning",
  "border.warning",
  "fg.info",
  "bg.info",
  "border.info",
] as const;

const chartColours = [
  "chart.1",
  "chart.2",
  "chart.3",
  "chart.4",
  "chart.5",
  "chart.6",
  "chart.7",
  "chart.8",
] as const;

const overlayColours = ["bg.scrim"] as const;

function Swatch({ token }: { token: string }) {
  return (
    <Stack gap="2">
      <Box
        aria-label={token}
        background={token}
        borderColor="border.muted"
        borderWidth="1px"
        borderRadius="md"
        height="16"
      />
      <Text color="fg.muted" fontFamily="mono" fontSize="sm">
        {token}
      </Text>
    </Stack>
  );
}

function ColourFoundations() {
  return (
    <Stack gap="10" maxWidth="5xl">
      <Stack gap="1">
        <Heading size="lg">Colour foundations</Heading>
        <Text color="fg.muted">
          Raw palette values support the system; semantic tokens are the default for components.
        </Text>
      </Stack>

      <Stack gap="4">
        <Heading size="md">Foundations</Heading>
        <Grid gap="4" templateColumns="repeat(auto-fit, minmax(9rem, 1fr))">
          {foundationColours.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </Grid>
      </Stack>

      <Stack gap="4">
        <Heading size="md">Semantic tokens</Heading>
        <Grid gap="4" templateColumns="repeat(auto-fit, minmax(9rem, 1fr))">
          {semanticColours.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </Grid>
      </Stack>

      <Stack gap="4">
        <Heading size="md">Accent (brand orange)</Heading>
        <Grid gap="4" templateColumns="repeat(auto-fit, minmax(9rem, 1fr))">
          {accentColours.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </Grid>
      </Stack>

      <Stack gap="4">
        <Heading size="md">Status</Heading>
        <Grid gap="4" templateColumns="repeat(auto-fit, minmax(9rem, 1fr))">
          {statusColours.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </Grid>
      </Stack>

      <Stack gap="4">
        <Heading size="md">Chart series</Heading>
        <Grid gap="4" templateColumns="repeat(auto-fit, minmax(9rem, 1fr))">
          {chartColours.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </Grid>
      </Stack>

      <Stack gap="4">
        <Heading size="md">Overlay</Heading>
        <Grid gap="4" templateColumns="repeat(auto-fit, minmax(9rem, 1fr))">
          {overlayColours.map((token) => (
            <Swatch key={token} token={token} />
          ))}
        </Grid>
      </Stack>
    </Stack>
  );
}

const meta = {
  title: "Foundations/Colour",
  component: ColourFoundations,
  tags: ["autodocs"],
  parameters: {
    controls: { disable: true },
  },
} satisfies Meta<typeof ColourFoundations>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
