import { Box, Button, Stack, Switch, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Users } from "lucide-react";
import { useState } from "react";

import { ContentTabs, type ContentTabItem, type ContentTabsProps } from "./content-tabs.tsx";

type Name = "overview" | "people" | "billing" | "audit";

const panel = (text: string) => (
  <Text color="fg.muted" textStyle="sm">
    {text}
  </Text>
);

const ITEMS: ContentTabItem<Name>[] = [
  { value: "overview", label: "Overview", content: panel("The overview view.") },
  { value: "people", label: "People", count: 12, content: panel("Everyone in this organisation.") },
  { value: "billing", label: "Billing", count: 0, content: panel("Invoices and plan.") },
  { value: "audit", label: "Audit log", content: panel("Every change, newest first.") },
];

function Controlled(props: Partial<ContentTabsProps<Name>>) {
  const [value, setValue] = useState<Name>("overview");
  return (
    <ContentTabs<Name>
      label="Organisation sections"
      items={ITEMS}
      {...props}
      value={value}
      onValueChange={(next) => setValue(next.value)}
    />
  );
}

const meta = {
  title: "Navigation and layout/Content tabs",
  component: ContentTabs,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "Another view of the same subject inside a page, drawer, dialog or card: tablist, tab and tabpanel with one underline look. The caller owns `value` (useState or a ?tab= param). Pick `mount` for what a hidden panel should keep: lazy keeps a chat, active drops a query, all keeps an editor. Counts, a disabled reason, a shortcut and a description are props, never restyles.",
      avoid:
        "Header tabs that are links to other routes: PageLayout.Tabs. A filter with no panels: FilterChips or SegmentedControl. Style props, variants and palettes: none exist on purpose.",
    },
  },
  args: { value: "overview", onValueChange: () => undefined, items: [], label: "Sections" },
} satisfies Meta<typeof ContentTabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Controlled /> };
export const Compact: Story = { render: () => <Controlled density="compact" /> };
export const WithIconsAndShortcuts: Story = {
  render: () => (
    <Controlled
      items={ITEMS.map((item) => ({
        ...item,
        icon: item.value === "people" ? <Users size={14} /> : undefined,
        shortcut: item.value === "billing" ? "g b" : undefined,
        description: item.value === "people" ? "Members and pending invitations." : undefined,
      }))}
    />
  ),
};
/** A disabled tab stays reachable by arrow keys and says why, to everyone. */
export const DisabledWithReason: Story = {
  render: () => (
    <Controlled
      items={ITEMS.map((item) =>
        item.value === "billing"
          ? { ...item, disabled: { reason: "Billing needs the Team plan." } }
          : item,
      )}
    />
  ),
};
/** Arrows move focus; Enter or Space selects. For panels that start a noticeable load. */
export const ManualActivation: Story = { render: () => <Controlled activationMode="manual" /> };
export const Flush: Story = { render: () => <Controlled body="flush" /> };
export const Inset: Story = { render: () => <Controlled inset="md" /> };
/** none, sm (16px) and md (24px) side space: the strip's rule stays full width in each. */
export const InsetScale: Story = {
  render: () => (
    <Stack gap={8}>
      {(["none", "sm", "md"] as const).map((inset) => (
        <Controlled key={inset} inset={inset} label={`Inset ${inset}`} />
      ))}
    </Stack>
  ),
};
/** The 16px inset in a 320px host, flush and padded. */
export const InsetNarrow: Story = {
  render: () => (
    <Box maxWidth="320px">
      <Stack gap={8}>
        {(["padded", "flush"] as const).map((body) => (
          <Controlled key={body} inset="sm" body={body} label={`Inset sm ${body}`} />
        ))}
      </Stack>
    </Box>
  ),
};

function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <Button size="xs" variant="outline" onClick={() => setCount(count + 1)}>
      {label} {count}
    </Button>
  );
}
/** Lazy keeps the first panel's state; active would reset it; all mounts every panel up front. */
export const MountPolicies: Story = {
  render: () => (
    <Stack gap={8}>
      {(["lazy", "active", "all"] as const).map((mount) => (
        <Controlled
          key={mount}
          mount={mount}
          label={`Mount ${mount}`}
          items={ITEMS.map((item) => ({ ...item, content: <Counter label={`${mount} panel`} /> }))}
        />
      ))}
    </Stack>
  ),
};
export const WithActions: Story = {
  render: () => (
    <Controlled
      actions={
        <>
          <Switch.Root size="sm">
            <Switch.HiddenInput />
            <Switch.Control />
            <Switch.Label>Raw</Switch.Label>
          </Switch.Root>
          <Button size="xs" variant="outline">
            Add query
          </Button>
        </>
      }
    />
  ),
};
export const WithPanelHeader: Story = {
  render: () => (
    <Controlled
      panelHeader={
        <Box height="6px" bg="border.muted" cursor="row-resize" aria-hidden data-testid="divider" />
      }
    />
  ),
};
export const ScrollPanel: Story = {
  render: () => (
    <Box height="200px" borderWidth="1px" borderColor="border.muted">
      <Controlled
        scroll="panel"
        inset="md"
        items={ITEMS.map((item) => ({
          ...item,
          content: <Box height="400px">{panel("A tall panel scrolls under a pinned strip.")}</Box>,
        }))}
      />
    </Box>
  ),
};
export const ScrollContent: Story = {
  render: () => (
    <Box height="200px" borderWidth="1px" borderColor="border.muted">
      <Controlled
        scroll="content"
        body="flush"
        items={ITEMS.map((item) => ({
          ...item,
          content: (
            <Box flex="1" minHeight={0} overflow="auto">
              <Box height="400px">{panel("The content owns the scrolling.")}</Box>
            </Box>
          ),
        }))}
      />
    </Box>
  ),
};
/** At 320px a long strip scrolls sideways in one line and a focused tab scrolls into view. */
export const Narrow: Story = {
  render: () => (
    <Box maxWidth="320px">
      <Controlled
        actions={
          <Button size="xs" variant="outline">
            Add query
          </Button>
        }
        items={ITEMS.map((item) =>
          item.value === "audit"
            ? { ...item, label: "Teams and projects with long names", count: 128 }
            : item,
        )}
      />
    </Box>
  ),
};
