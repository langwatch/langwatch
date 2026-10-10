import { Separator, Stack, Tabs, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { TabCount } from "../components/values/tab-count.tsx";

const meta = {
  title: "Navigation and layout/Tabs",
  parameters: {
    usage: {
      use: "Switching between views of one subject on a page, such as Catalog, Environments and Sources. `line` draws the selected tab and its rule in the accent orange.",
      avoid:
        "Two to four modes of the same content in a toolbar: use Segmented control. Moving between pages: use the sidebar.",
    },
  },
  component: Tabs.Root,
  tags: ["autodocs"],
} satisfies Meta<typeof Tabs.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const TABS = [
  { value: "catalog", label: "Catalog", count: 9 },
  { value: "environments", label: "Environments", count: 0 },
  { value: "sources", label: "Sources", count: 3 },
];

function LineTabs({ variant }: { variant: "line" | "subtle" | "enclosed" }) {
  return (
    <Tabs.Root defaultValue="catalog" variant={variant} colorPalette="accent">
      <Tabs.List>
        {TABS.map((tab) => (
          <Tabs.Trigger key={tab.value} value={tab.value}>
            {tab.label}
            <TabCount value={tab.count} />
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {TABS.map((tab) => (
        <Tabs.Content key={tab.value} value={tab.value}>
          <Text color="fg.muted">The {tab.label.toLowerCase()} view.</Text>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

/** The page tabs: the selected tab and its rule in the accent orange, each with its count. */
export const Default: Story = { render: () => <LineTabs variant="line" /> };

/** Every variant, side by side. */
export const Variants: Story = {
  render: () => (
    <Stack gap={8}>
      {(["line", "subtle", "enclosed"] as const).map((variant) => (
        <Stack key={variant} gap={2}>
          <Text textStyle="xs" color="fg.muted">
            {variant}
          </Text>
          <LineTabs variant={variant} />
        </Stack>
      ))}
    </Stack>
  ),
};

/** The accent rule on its own, for a section break that belongs to the tabs above it. */
export const AccentSeparator: Story = {
  render: () => (
    <Stack gap={3} width="28rem">
      <Text>Above the rule</Text>
      <Separator borderColor="accent.solid" />
      <Text>Below the rule</Text>
    </Stack>
  ),
};
