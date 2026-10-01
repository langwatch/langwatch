import { Box, Code, Heading, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

const headingSizes = ["4xl", "3xl", "2xl", "xl", "lg", "md", "sm"] as const;

const meta: Meta = {
  title: "Foundations/Typography",
  parameters: {
    docs: {
      description: {
        component:
          "The three faces the tokens name: Sentient for headings, Inter for body, JetBrains Mono for technical lines.",
      },
    },
  },
};

export default meta;

type Story = StoryObj;

export const Faces: Story = {
  render: () => (
    <Stack gap={10} maxWidth="52rem">
      <Stack gap={3}>
        <Text fontFamily="mono" fontSize="xs" color="fg.muted">
          fonts.heading
        </Text>
        {headingSizes.map((size) => (
          <Heading key={size} size={size}>
            The quick brown fox jumps
          </Heading>
        ))}
      </Stack>

      <Stack gap={3}>
        <Text fontFamily="mono" fontSize="xs" color="fg.muted">
          fonts.body
        </Text>
        <Text>
          Body copy is set in Inter. It carries the reading weight of the product: table cells,
          field labels, descriptions and every sentence a person is expected to read in full.
        </Text>
        <Text fontWeight="medium">The same face at medium weight, for emphasis in place.</Text>
      </Stack>

      <Stack gap={3}>
        <Text fontFamily="mono" fontSize="xs" color="fg.muted">
          fonts.mono
        </Text>
        <Text fontFamily="mono">
          span_id 7f3c9a20b1de4c88 &middot; 148 ms &middot; 1,024 tokens
        </Text>
        <Box>
          <Code>pnpm dev:api</Code>
        </Box>
      </Stack>
    </Stack>
  ),
};
