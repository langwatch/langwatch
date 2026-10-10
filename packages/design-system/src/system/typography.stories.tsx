import { Box, Code, Heading, HStack, Stack, Table, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { system } from "./create-system.ts";

/**
 * Two type systems. Productive is the application: Inter at a dense 14px body,
 * the text styles below. Expressive is the voice of the brand: the Sentient display
 * serif on branded pages and Langy, and mail's own cut of it in `packages/mail`.
 */
const textStyles = Object.entries(
  (system._config.theme?.textStyles ?? {}) as Record<string, { value?: Record<string, unknown> }>,
);
const headingSizes = ["4xl", "3xl", "2xl", "xl", "lg", "md", "sm", "xs"] as const;

/** Mail's expressive cut, as `packages/mail/src/templates/email-layout.tsx` sets it. */
const MAIL_SCALE = [
  ["Headline", "24px", "The message's one heading (h1)"],
  ["Paragraph", "15px", "The message itself"],
  ["Muted", "13.5px", "Context rather than the message"],
  ["Fine print", "12px", "Why this arrived, and what to ignore"],
] as const;

function Face({ token, sample, note }: { token: string; sample: string; note: string }) {
  return (
    <Stack gap={1}>
      <Text fontFamily="mono" fontSize="xs" color="fg.muted">
        fonts.{token} · {note}
      </Text>
      <Text fontFamily={token} fontSize="2xl">
        {sample}
      </Text>
    </Stack>
  );
}

const meta = {
  title: "Foundations/Typography",
  parameters: {
    usage: {
      use: "Productive type everywhere in the application: `textStyle` for size and leading, `Heading size` for titles, `fonts.mono` for ids, durations and code. Expressive type (`fonts.display`) only on branded pages, onboarding and Langy.",
      avoid:
        "A `fontSize` in pixels, a font family string, or the display serif on a product screen.",
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Faces: Story = {
  render: () => (
    <Stack gap={8} maxWidth="52rem">
      <Face
        token="body"
        sample="Traces arrive within a minute"
        note="Inter: body copy, labels, tables"
      />
      <Face token="heading" sample="Evaluations" note="Inter: product headings" />
      <Face
        token="mono"
        sample="span_id 7f3c9a20 · 148 ms"
        note="JetBrains Mono: ids, numbers, code"
      />
      <Face token="display" sample="Ask Langy anything" note="Sentient: the expressive voice" />
    </Stack>
  ),
};

/** The productive scale: one `textStyle` sets size and leading together. */
export const ProductiveScale: Story = {
  render: () => (
    <Table.Root size="sm" variant="line">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>textStyle</Table.ColumnHeader>
          <Table.ColumnHeader>Values</Table.ColumnHeader>
          <Table.ColumnHeader>Sample</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {textStyles.map(([name, style]) => (
          <Table.Row key={name}>
            <Table.Cell>
              <Code>{name}</Code>
            </Table.Cell>
            <Table.Cell>
              <Text fontFamily="mono" fontSize="xs" color="fg.muted">
                {Object.entries(style.value ?? {})
                  .map(([key, value]) => `${key} ${String(value)}`)
                  .join(" · ")}
              </Text>
            </Table.Cell>
            <Table.Cell>
              <Text textStyle={name}>The quick brown fox</Text>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  ),
};

export const Headings: Story = {
  render: () => (
    <Stack gap={3}>
      {headingSizes.map((size) => (
        <HStack key={size} gap={4} align="baseline">
          <Text width={10} fontFamily="mono" fontSize="xs" color="fg.muted">
            {size}
          </Text>
          <Heading size={size}>Prompt versions</Heading>
        </HStack>
      ))}
    </Stack>
  ),
};

/** Expressive type: the display serif, large and loose, with the product face beneath it. */
export const Expressive: Story = {
  render: () => (
    <Stack gap={10} maxWidth="52rem">
      <Stack gap={3}>
        <Text fontFamily="display" fontSize="5xl" lineHeight="1.05" letterSpacing="tight">
          See what your agents actually do
        </Text>
        <Text fontSize="lg" color="fg.muted" maxWidth="36rem">
          The display face sets the headline on branded pages, the onboarding takeover and Langy;
          the body beneath it stays productive.
        </Text>
      </Stack>
      <Stack gap={2}>
        <Heading size="sm">Mail&apos;s expressive cut</Heading>
        <Text color="fg.muted">
          Mail uses one system face and no web font (a remote font in mail is a tracking pixel). Its
          scale lives in <Code>packages/mail/src/templates/email-layout.tsx</Code>; the
          mail-template skill covers it.
        </Text>
        <Box>
          <Table.Root size="sm" variant="line">
            <Table.Body>
              {MAIL_SCALE.map(([role, size, where]) => (
                <Table.Row key={role}>
                  <Table.Cell>{role}</Table.Cell>
                  <Table.Cell>
                    <Code>{size}</Code>
                  </Table.Cell>
                  <Table.Cell color="fg.muted">{where}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      </Stack>
    </Stack>
  ),
};
