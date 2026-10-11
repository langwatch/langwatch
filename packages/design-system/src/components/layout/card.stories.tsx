import type { Meta, StoryObj } from "@storybook/react-vite";
import { KeyRound } from "lucide-react";

import { Badge, Button, Text } from "../../primitives.ts";
import { Card, CardGrid } from "./card.tsx";

const meta = {
  title: "Data display/Card",
  parameters: {
    usage: {
      use: "Every framed surface: `panel` on a page, `nested` as a well inside a card, drawer or dialog, `frame` round an editor or image, `elevated` off the page, `showcase` for hero figures (governance and gateway panels). Give it a `title` to make a section card; lay several out with `CardGrid`.",
      avoid:
        "A Box with a border and radius (hand-drawn card), width or height on a card (the grid sizes it), a card inside a card except `nested` or `frame`. A notice is a Banner, a pill is a Chip, an empty box is NoDataInfoBlock.",
    },
  },
  component: Card,
  tags: ["autodocs"],
  args: {
    title: "Single sign-on",
    description: "Members sign in through your identity provider.",
    children: <Text textStyle="sm">Okta · 214 members provisioned</Text>,
  },
  argTypes: {
    variant: { control: "select", options: ["panel", "nested", "frame", "elevated", "showcase"] },
    padding: { control: "inline-radio", options: ["md", "sm", "none"] },
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Panel: Story = {};

export const SectionCard: Story = {
  args: {
    icon: <KeyRound size={16} />,
    status: "ok",
    badge: <Badge colorPalette="green">Active</Badge>,
    actions: (
      <Button size="xs" variant="outline">
        Edit
      </Button>
    ),
    footer: (
      <Button size="sm" variant="outline">
        Test connection
      </Button>
    ),
  },
};

export const Variants: Story = {
  render: () => (
    <CardGrid columns={3}>
      {(["panel", "nested", "frame", "elevated", "showcase"] as const).map((variant) => (
        <Card key={variant} variant={variant} title={variant}>
          <Text textStyle="sm">The {variant} surface.</Text>
        </Card>
      ))}
    </CardGrid>
  ),
};

/** The governance and gateway look, as one named variant (ruling "Cards", ADR-002). */
export const Showcase: Story = {
  args: {
    variant: "showcase",
    title: "Spend this month",
    children: <Text textStyle="2xl">$12,480</Text>,
  },
};

/** A column body (stack, or spaced for 12px between children) and a dashed placeholder. */
export const BodyLayout: Story = {
  render: () => (
    <CardGrid columns={3}>
      <Card bodyLayout="stack" title="stack">
        <Text textStyle="sm">First</Text>
        <Text textStyle="sm">Second</Text>
      </Card>
      <Card bodyLayout="spaced" title="spaced">
        <Text textStyle="sm">First</Text>
        <Text textStyle="sm">Second</Text>
      </Card>
      <Card placeholder title="placeholder">
        <Text textStyle="sm">Not reported yet</Text>
      </Card>
    </CardGrid>
  ),
};

export const Padding: Story = {
  render: () => (
    <CardGrid columns={3}>
      {(["md", "sm", "none"] as const).map((padding) => (
        <Card key={padding} padding={padding} title={`padding ${padding}`}>
          <Text textStyle="sm">Body</Text>
        </Card>
      ))}
    </CardGrid>
  ),
};

export const LongText: Story = {
  args: {
    title: "A section card title long enough to wrap beside its badge and actions",
    description: "A description that also runs long, so the card shows how its header wraps.",
    badge: <Badge>Needs attention</Badge>,
  },
};

export const Grid: Story = {
  render: () => (
    <CardGrid columns={4}>
      {["Traces", "Datasets", "Evaluations", "Prompts", "Agents"].map((name) => (
        <Card key={name} title={name}>
          <Text textStyle="sm">
            {name === "Agents" ? "A longer body line that wraps." : "Ready"}
          </Text>
        </Card>
      ))}
    </CardGrid>
  ),
};
