import { Card, Heading, HStack, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { FieldInfoTooltip } from "../components/forms/field-info-tooltip.tsx";

const meta = {
  title: "Primitives/Card",
  parameters: {
    usage: {
      use: "A group of facts or controls about one thing. `elevated` sits up off the page (figures, tiles); `outline` sits flat in a list; `subtle` fills a quiet panel.",
      avoid:
        'A hand-built Box with a border and a shadow: use `Card.Root variant="elevated"`. A whole settings block: use Settings card.',
    },
  },
  component: Card.Root,
  tags: ["autodocs"],
  args: { variant: "elevated" },
  argTypes: {
    variant: { control: "inline-radio", options: ["elevated", "outline", "subtle"] },
  },
} satisfies Meta<typeof Card.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A figure card, as the governance cost and inventory screens draw them. */
function FigureCard({ label, figure, info }: { label: string; figure: string; info: string }) {
  return (
    <Card.Root variant="elevated">
      <Card.Body padding={4} gap={1}>
        <HStack gap={2}>
          <Heading size="sm">{label}</Heading>
          <FieldInfoTooltip description={info} />
        </HStack>
        <Text textStyle="2xl" fontWeight="semibold">
          {figure}
        </Text>
      </Card.Body>
    </Card.Root>
  );
}

export const Default: Story = {
  render: (args) => (
    <Card.Root {...args} width="20rem">
      <Card.Body padding={4} gap={1}>
        <Heading size="sm">Metered by gateway</Heading>
        <Text textStyle="2xl" fontWeight="semibold">
          $0.02013
        </Text>
      </Card.Body>
    </Card.Root>
  ),
};

/** Every variant side by side. */
export const Variants: Story = {
  render: () => (
    <HStack gap={4} align="stretch">
      {(["elevated", "outline", "subtle"] as const).map((variant) => (
        <Card.Root key={variant} variant={variant} width="16rem">
          <Card.Body padding={4} gap={1}>
            <Heading size="sm">{variant}</Heading>
            <Text color="fg.muted" textStyle="sm">
              A group of facts or controls about one thing.
            </Text>
          </Card.Body>
        </Card.Root>
      ))}
    </HStack>
  ),
};

/**
 * Figures in a row, and the dashed card for a figure not collected yet: `outline` with a
 * dashed border, flat, so it reads as a slot waiting to be filled.
 */
export const FiguresAndAnEmptySlot: Story = {
  render: () => (
    <SimpleGrid columns={3} gap={4} width="48rem">
      <FigureCard label="Billed by provider" figure="—" info="Provider-reported costs." />
      <FigureCard label="Metered by gateway" figure="$0.02013" info="What the gateway metered." />
      <Card.Root variant="outline" borderStyle="dashed" boxShadow="none">
        <Card.Body padding={4} gap={1}>
          <Heading size="sm">Seats</Heading>
          <Stack gap={1}>
            <Text color="fg.muted" textStyle="sm">
              Seat data is not yet available.
            </Text>
          </Stack>
        </Card.Body>
      </Card.Root>
    </SimpleGrid>
  ),
};

/** A clickable card adds its own hover lift; the variant stays still. */
export const Clickable: Story = {
  render: () => (
    <Card.Root variant="elevated" width="18rem" cursor="pointer" _hover={{ boxShadow: "lg" }}>
      <Card.Body padding={4} gap={1}>
        <Heading size="sm">Exact match evaluator</Heading>
        <Text color="fg.muted" textStyle="sm">
          Checks the output equals the expected answer.
        </Text>
      </Card.Body>
    </Card.Root>
  ),
};
