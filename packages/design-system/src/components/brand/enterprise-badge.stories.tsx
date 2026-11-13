import { HStack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { EnterpriseBadge } from "./enterprise-badge.tsx";

const meta = {
  title: "Brand/Enterprise badge",
  parameters: {
    usage: {
      use: "Beside a sidebar entry, a page title or a setting the Enterprise plan gates. See docs/feature-branding.md.",
      avoid:
        "A refusal or an error; the plan comparison table; a control the plan already carries.",
    },
  },
  component: EnterpriseBadge,
  tags: ["autodocs"],
} satisfies Meta<typeof EnterpriseBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The same quiet badge wherever it sits. */
export const Default: Story = {};

/** Beside a title or a setting's name, as it appears in the product. */
export const BesideATitle: Story = {
  render: () => (
    <HStack gap="2">
      <Text textStyle="lg" fontWeight="semibold">
        Braids
      </Text>
      <EnterpriseBadge />
    </HStack>
  ),
};

/** A menu row: the compact lock keeps the label whole; hover or a screen reader says Enterprise. */
export const CompactInAMenuRow: Story = {
  render: () => (
    <HStack gap="2" width="48" minWidth={0}>
      <Text textStyle="sm" truncate flex="1">
        Roles & access
      </Text>
      <EnterpriseBadge compact />
    </HStack>
  ),
};

/** A narrow row: the badge keeps its width and the name truncates. */
export const Narrow: Story = {
  render: () => (
    <HStack gap="2" width="40" minWidth={0}>
      <Text textStyle="sm" truncate>
        Require two-step verification for everyone
      </Text>
      <EnterpriseBadge />
    </HStack>
  ),
};
