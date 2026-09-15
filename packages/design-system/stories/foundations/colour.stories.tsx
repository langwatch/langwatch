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
