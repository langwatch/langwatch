import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus, Settings } from "lucide-react";

import {
  Badge,
  Box,
  Button,
  Card,
  Field,
  Grid,
  Heading,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Separator,
  Skeleton,
  SkeletonText,
  Spinner,
  Stack,
  Tabs,
  Text,
  Textarea,
  VStack,
} from "./primitives.ts";

const BUTTON_VARIANTS = ["solid", "subtle", "surface", "outline", "ghost", "plain"] as const;
const SIZES = ["xs", "sm", "md", "lg"] as const;
const BADGE_PALETTES = ["gray", "green", "red", "orange", "blue", "purple"] as const;

const meta = {
  title: "Primitives/Building blocks",
  parameters: {
    usage: {
      use: "Layout (`Box`, `Stack`, `HStack`, `Grid`), text, buttons, fields, badges, cards and loading placeholders, imported from `@langwatch/design-system/primitives`. Props and tokens only.",
      avoid:
        "Anything a named component already does: Checkbox, Switch, Tooltip, Menu, Dialog, Drawer and Avatar come from their own subpath; a list is List table; an empty state is Empty state. Never `@chakra-ui/react` outside this package.",
    },
    docs: {
      description: {
        component:
          "Chakra's primitives, re-exported unchanged so only the design system imports Chakra. They are the most imported thing in the product; the adoption table shows which.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = {
  render: () => (
    <Stack gap={4}>
      {BUTTON_VARIANTS.map((variant) => (
        <HStack key={variant} gap={3}>
          <Text width={16} fontFamily="mono" fontSize="xs" color="fg.muted">
            {variant}
          </Text>
          {SIZES.map((size) => (
            <Button key={size} variant={variant} size={size}>
              Save prompt
            </Button>
          ))}
          <Button variant={variant} size="sm" loading>
            Saving
          </Button>
          <Button variant={variant} size="sm" disabled>
            Disabled
          </Button>
        </HStack>
      ))}
      <HStack gap={3}>
        <Button colorPalette="accent" size="sm">
          <Plus aria-hidden /> New evaluation
        </Button>
        <Button colorPalette="red" variant="outline" size="sm">
          Delete dataset
        </Button>
        <IconButton aria-label="Open settings" variant="ghost" size="sm">
          <Settings />
        </IconButton>
      </HStack>
    </Stack>
  ),
};

export const Badges: Story = {
  render: () => (
    <Stack gap={3}>
      {(["subtle", "surface", "outline", "solid"] as const).map((variant) => (
        <HStack key={variant} gap={2}>
          {BADGE_PALETTES.map((palette) => (
            <Badge key={palette} variant={variant} colorPalette={palette}>
              {palette}
            </Badge>
          ))}
        </HStack>
      ))}
    </Stack>
  ),
};

export const Fields: Story = {
  render: () => (
    <Stack gap={5} maxWidth="26rem">
      <Field.Root required>
        <Field.Label>
          Project name <Field.RequiredIndicator />
        </Field.Label>
        <Input placeholder="Customer support agent" />
        <Field.HelperText>Shown in the project switcher.</Field.HelperText>
      </Field.Root>
      <Field.Root invalid>
        <Field.Label>Webhook address</Field.Label>
        <Input defaultValue="not-an-address" />
        <Field.ErrorText>Enter a full address, starting with https://</Field.ErrorText>
      </Field.Root>
      <Field.Root disabled>
        <Field.Label>Project id</Field.Label>
        <Input defaultValue="project_2n8Kq4" />
      </Field.Root>
      <Field.Root>
        <Field.Label>Description</Field.Label>
        <Textarea placeholder="What this project traces" />
      </Field.Root>
      <Field.Root>
        <Field.Label>Region</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field defaultValue="eu">
            <option value="eu">Europe</option>
            <option value="us">United States</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field.Root>
    </Stack>
  ),
};

/** Spacing comes from the scale: `gap={4}` is 16px, and siblings never carry their own margins. */
export const Layout: Story = {
  render: () => (
    <Stack gap={6}>
      <HStack gap={4}>
        {[1, 2, 3].map((n) => (
          <Box key={n} padding={4} bg="bg.muted" borderRadius="md">
            HStack gap 4
          </Box>
        ))}
      </HStack>
      <VStack gap={2} align="stretch" maxWidth="20rem">
        {[1, 2].map((n) => (
          <Box key={n} padding={3} bg="bg.muted" borderRadius="md">
            VStack gap 2
          </Box>
        ))}
      </VStack>
      <Grid templateColumns="repeat(3, 1fr)" gap={3}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <Box key={n} padding={3} bg="bg.muted" borderRadius="md">
            Grid {n}
          </Box>
        ))}
      </Grid>
    </Stack>
  ),
};

export const Cards: Story = {
  render: () => (
    <HStack gap={4} align="stretch">
      {(["elevated", "outline", "subtle"] as const).map((variant) => (
        <Card.Root key={variant} variant={variant} width="16rem">
          <Card.Header>
            <Heading size="sm">Card {variant}</Heading>
          </Card.Header>
          <Card.Body>
            <Text color="fg.muted">A group of facts or controls about one thing.</Text>
          </Card.Body>
        </Card.Root>
      ))}
    </HStack>
  ),
};

/** Loading: a skeleton where the shape is known, a spinner where it is not. */
export const Loading: Story = {
  render: () => (
    <HStack gap={10} align="start">
      <Stack gap={3} width="18rem">
        <Skeleton height={6} width="60%" />
        <SkeletonText noOfLines={3} />
      </Stack>
      <HStack gap={4}>
        {(["sm", "md", "lg"] as const).map((size) => (
          <Spinner key={size} size={size} />
        ))}
      </HStack>
    </HStack>
  ),
};

export const TabsAndSeparators: Story = {
  render: () => (
    <Stack gap={6} maxWidth="32rem">
      <Tabs.Root defaultValue="traces">
        <Tabs.List>
          <Tabs.Trigger value="traces">Traces</Tabs.Trigger>
          <Tabs.Trigger value="evaluations">Evaluations</Tabs.Trigger>
          <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="traces">The traces tab.</Tabs.Content>
        <Tabs.Content value="evaluations">The evaluations tab.</Tabs.Content>
        <Tabs.Content value="settings">The settings tab.</Tabs.Content>
      </Tabs.Root>
      <Separator />
      <Text color="fg.muted">A separator is a hairline in `border`, never a styled Box.</Text>
    </Stack>
  ),
};
