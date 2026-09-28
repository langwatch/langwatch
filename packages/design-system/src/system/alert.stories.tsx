import { Alert, Button, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

const STATUSES = ["info", "success", "warning", "error", "neutral"] as const;
const VARIANTS = ["subtle", "surface", "outline", "solid"] as const;

const COPY: Record<(typeof STATUSES)[number], { title: string; description: string }> = {
  info: {
    title: "Traces arrive within a minute",
    description: "New projects take a moment before the first trace shows here.",
  },
  success: {
    title: "The integration is configured",
    description: "Traces from this project are reaching LangWatch.",
  },
  warning: {
    title: "The budget is nearly spent",
    description: "92 percent of this period's limit is used.",
  },
  error: {
    title: "Could not load the evaluations",
    description: "We've been notified. Try again in a moment.",
  },
  neutral: {
    title: "This dataset is read only",
    description: "It was imported from a shared workspace.",
  },
};

const meta = {
  title: "Primitives/Alert",
  component: Alert.Root,
  tags: ["autodocs"],
  args: { status: "info", variant: "subtle", size: "md" },
  argTypes: {
    status: { control: "select", options: STATUSES },
    variant: { control: "select", options: VARIANTS },
    size: { control: "select", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof Alert.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Alert.Root {...args}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{COPY.info.title}</Alert.Title>
        <Alert.Description>{COPY.info.description}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  ),
};

/** Every status in every variant; switch the toolbar's colour mode to compare. */
export const StatusesByVariant: Story = {
  render: () => (
    <SimpleGrid columns={{ base: 1, lg: 2 }} gap="6">
      {VARIANTS.map((variant) => (
        <Stack key={variant} gap="3">
          <Text textStyle="xs" color="fg.muted">
            {variant}
          </Text>
          {STATUSES.map((status) => (
            <Alert.Root key={status} status={status} variant={variant}>
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{COPY[status].title}</Alert.Title>
                <Alert.Description>{COPY[status].description}</Alert.Description>
              </Alert.Content>
            </Alert.Root>
          ))}
        </Stack>
      ))}
    </SimpleGrid>
  ),
};

/** The three sizes; the icon stays centred on the first line of text. */
export const Sizes: Story = {
  render: () => (
    <Stack gap="3" maxWidth="xl">
      {(["sm", "md", "lg"] as const).map((size) => (
        <Alert.Root key={size} status="warning" size={size}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{COPY.warning.title}</Alert.Title>
            <Alert.Description>{COPY.warning.description}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ))}
    </Stack>
  ),
};

/** The compact size for dense surfaces: a table cell, a canvas node, a popover. */
export const Compact: Story = {
  render: () => (
    <Stack gap="2" maxWidth="md">
      {STATUSES.map((status) => (
        <Alert.Root key={status} status={status} size="sm">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{COPY[status].description}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ))}
    </Stack>
  ),
};

/** A title alone, and a long description with an action, at a narrow width. */
export const TitleOnlyAndLongText: Story = {
  render: () => (
    <Stack gap="3" maxWidth="sm">
      <Alert.Root status="success">
        <Alert.Indicator />
        <Alert.Title>{COPY.success.title}</Alert.Title>
      </Alert.Root>
      <Alert.Root status="error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>The evaluator could not reach the model provider</Alert.Title>
          <Alert.Description>
            The provider answered with a refusal for every row in this batch. Check the key in the
            model provider settings, then run the evaluation again.
          </Alert.Description>
          <Button size="xs" variant="outline" alignSelf="start" marginTop="2">
            Open model providers
          </Button>
        </Alert.Content>
      </Alert.Root>
    </Stack>
  ),
};
