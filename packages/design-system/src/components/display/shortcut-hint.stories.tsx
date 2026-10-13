import { Box, Button, HStack, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Tooltip } from "../overlays/tooltip.tsx";
import { ShortcutHint, shortcutAriaKeys } from "./shortcut-hint.tsx";

const meta = {
  title: "Data display/Shortcut hint",
  parameters: {
    usage: {
      use: "Beside the action an existing shortcut operates: a tab, a menu item, a tooltip.",
      avoid: "Inventing a shortcut, or as the only name of an action. It registers no key.",
    },
  },
  component: ShortcutHint,
  tags: ["autodocs"],
  args: {
    platform: "other",
    shortcut: { alternatives: [{ keys: ["r"] }] },
  },
} satisfies Meta<typeof ShortcutHint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleKey: Story = {};

export const Chord: Story = {
  args: { shortcut: { alternatives: [{ keys: ["Shift", "Enter"] }] } },
};

export const Alternatives: Story = {
  args: { shortcut: { alternatives: [{ keys: ["Enter"] }, { keys: ["ArrowDown"] }] } },
};

export const Mac: Story = {
  args: {
    platform: "mac",
    shortcut: { alternatives: [{ keys: ["Control", "f"] }, { keys: ["Meta", "f"] }] },
  },
};

export const OtherPlatform: Story = {
  args: {
    platform: "other",
    shortcut: { alternatives: [{ keys: ["Control", "f"] }, { keys: ["Meta", "f"] }] },
  },
};

/** The scope is spoken, not drawn: a screen reader hears it before the keys. */
export const LongContextualText: Story = {
  args: {
    shortcut: {
      alternatives: [{ keys: ["Shift", "Enter"] }, { keys: ["ArrowUp"] }],
      scopeLabel: "While the find field is focused",
    },
  },
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box width="120px" borderWidth="1px" borderColor="border" padding="2">
      <ShortcutHint {...args} shortcut={{ alternatives: [{ keys: ["Shift", "Enter"] }] }} />
    </Box>
  ),
};

/** Beside a label in a tab or menu row. The label stays the accessible name. */
export const InlineInTabAndMenu: Story = {
  render: (args) => (
    <Stack gap="3" width="220px">
      <HStack justify="space-between">
        <Text textStyle="sm">Summary</Text>
        <ShortcutHint {...args} decorative shortcut={{ alternatives: [{ keys: ["o"] }] }} />
      </HStack>
      <HStack justify="space-between">
        <Text textStyle="sm">View raw JSON</Text>
        <ShortcutHint {...args} decorative shortcut={{ alternatives: [{ keys: ["\\"] }] }} />
      </HStack>
    </Stack>
  ),
};

/** Hover or focus the button. The shortcut belongs on the real element as aria-keyshortcuts. */
export const InTooltip: Story = {
  render: () => {
    const shortcut = { alternatives: [{ keys: ["r"] }] } as const;
    return (
      <Tooltip content="Refresh trace" shortcut={shortcut} open>
        <Button size="sm" variant="outline" aria-keyshortcuts={shortcutAriaKeys(shortcut)}>
          Refresh
        </Button>
      </Tooltip>
    );
  },
};

/** An unavailable action advertises no key: render no hint at all. */
export const UnavailableAction: Story = {
  render: () => (
    <Button size="sm" variant="outline" disabled>
      Conversation
    </Button>
  ),
};

/** Trace-style chrome with realistic labels and no live data. */
export const TraceChrome: Story = {
  render: () => (
    <HStack gap="4">
      {(
        [
          ["Summary", "o"],
          ["Trace", "t"],
          ["Conversation", "c"],
          ["Usage", "s"],
        ] as const
      ).map(([label, key]) => (
        <HStack key={label} gap="1.5">
          <Text textStyle="sm">{label}</Text>
          <ShortcutHint
            decorative
            platform="other"
            shortcut={{ alternatives: [{ keys: [key] }] }}
          />
        </HStack>
      ))}
    </HStack>
  ),
};
