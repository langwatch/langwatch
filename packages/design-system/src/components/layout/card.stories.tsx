import type { Meta, StoryObj } from "@storybook/react-vite";
import { BarChart3, KeyRound, ShieldAlert } from "lucide-react";
import { createElement } from "react";

import { Badge, Box, Button, HStack, Text, VStack } from "../../primitives.ts";
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
    variant: {
      control: "select",
      options: [
        "panel",
        "nested",
        "frame",
        "frame-fill",
        "elevated",
        "showcase",
        "emphasized",
        "accent-row",
      ],
    },
    padding: { control: "inline-radio", options: ["xl", "inline-lg", "lg", "md", "sm", "none"] },
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

export const InsetScale: Story = {
  render: () => (
    <CardGrid columns={3}>
      {(["xl", "inline-lg", "lg"] as const).map((padding) => (
        <Card
          key={padding}
          padding={padding}
          title={`padding ${padding}`}
          data-testid={`inset-${padding}`}
        >
          <Text textStyle="sm">xl is 24px all round; inline-lg 24px across and 20px down.</Text>
        </Card>
      ))}
    </CardGrid>
  ),
};

const TONES = ["teal", "blue", "yellow", "red", "purple", "green", "neutral"] as const;

/**
 * A nested card with a tone is a tinted well: a muted border, a subtle fill and a heading in the
 * tone's foreground. Neutral is an inset in the border and subtle fill. Body text is unchanged.
 */
export const ToneWells: Story = {
  render: () => (
    <CardGrid columns={3}>
      {TONES.map((tone) => (
        <Card
          key={tone}
          variant="nested"
          tone={tone}
          padding="md"
          title={`${tone} well`}
          icon={<KeyRound size={16} />}
          data-testid={`well-${tone}`}
        >
          <Text textStyle="sm">Body text keeps its normal colour.</Text>
        </Card>
      ))}
    </CardGrid>
  ),
};

/** A neutral inset inside a teal well, as the RAG contexts sit in their panel. */
export const NeutralInsetInWell: Story = {
  render: () => (
    <Card variant="nested" tone="teal" padding="md" title="RAG Contexts">
      <VStack align="stretch" gap={2}>
        {[1, 2].map((n) => (
          <Card key={n} variant="nested" tone="neutral" padding="sm" data-testid={`context-${n}`}>
            <Text textStyle="sm">
              Context {n}: a retrieved passage that may run to a second line.
            </Text>
          </Card>
        ))}
      </VStack>
    </Card>
  ),
};

/** The one-line role edges: only the left edge carries the colour. */
export const AccentRows: Story = {
  render: () => (
    <VStack align="stretch" gap={2} maxWidth="28rem">
      {(
        [
          ["system", "purple"],
          ["user", "green"],
          ["assistant", "blue"],
          ["tool", "yellow"],
          ["unknown", "neutral"],
        ] as const
      ).map(([role, tone]) => (
        <Card key={role} variant="accent-row" tone={tone} data-testid={`row-${role}`}>
          <HStack gap={2}>
            <Text textStyle="sm" fontWeight="medium">
              {role}
            </Text>
            <Text textStyle="sm" color="fg.muted" truncate>
              A message long enough to be cut off at the end of a narrow row.
            </Text>
          </HStack>
        </Card>
      ))}
    </VStack>
  ),
};

/** The red danger well: the caller lays its own header and content out inside a flush card. */
export const DangerWell: Story = {
  render: () => (
    <Card variant="nested" tone="red" padding="none" data-testid="danger-well">
      <VStack align="stretch" gap={2} paddingX={4} paddingY={3.5}>
        <HStack gap={2} color="red.fg">
          <ShieldAlert size={14} aria-hidden />
          <Text textStyle="sm" fontWeight="semibold">
            Danger zone
          </Text>
        </HStack>
        <Text textStyle="sm">Removing the connection signs everyone out of it.</Text>
        <Box>
          <Button size="sm" variant="outline" colorPalette="red">
            Remove connection
          </Button>
        </Box>
      </VStack>
    </Card>
  ),
};

/** The plan row: an explicit edge, an opaque panel and a 2xl radius, still not a hero. */
export const Emphasized: Story = {
  render: () => (
    <CardGrid columns={2}>
      {["Free", "Growth"].map((plan) => (
        <Card
          key={plan}
          variant="emphasized"
          padding="xl"
          bodyLayout="stack"
          data-testid={`plan-${plan}`}
        >
          <Text as="h2" textStyle="sectionTitle">
            {plan}
          </Text>
          <Text textStyle="sm" color="fg.muted">
            Everything you need to start.
          </Text>
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

/**
 * An editor frame: it fills the height its parent gives it, keeps its border and radius, and
 * the editor inside scrolls. Shown at two heights beside a neighbour that keeps its room.
 */
export const FrameFill: Story = {
  render: () => (
    <HStack gap={4} align="stretch">
      {[200, 320].map((height) => (
        <VStack key={height} align="stretch" gap={3} height={`${height}px`} flex={1} minWidth={0}>
          <Text textStyle="sm">Above the editor</Text>
          <Card variant="frame-fill" data-testid={`frame-fill-${height}`}>
            <Box height="100%" overflowY="auto" paddingX={3} paddingY={2}>
              {Array.from({ length: 24 }, (_, line) => (
                <Text key={line} textStyle="sm" fontFamily="mono">
                  {`select ${line + 1} from traces;`}
                </Text>
              ))}
            </Box>
          </Card>
          <Text textStyle="sm">Below the editor</Text>
        </VStack>
      ))}
    </HStack>
  ),
};

/** The frame at 320px: it keeps its border and fills the narrow parent. */
export const FrameFillNarrow: Story = {
  render: () => (
    <VStack align="stretch" maxWidth="320px" height="200px">
      <Card variant="frame-fill">
        <Box height="100%" overflowY="auto" padding={3}>
          <Text textStyle="sm">
            A very long line of editor content that has to wrap inside a three hundred and twenty
            pixel frame without a second scroller appearing around the card itself.
          </Text>
        </Box>
      </Card>
    </VStack>
  ),
};

/**
 * A linked card: one native link is the focus target; the children are only presentation. The
 * border takes the product accent on hover. Without an opener a card has none of this.
 */
export const Linked: Story = {
  render: () => (
    <CardGrid columns={3}>
      <Card padding="none" opener={<a href="#dashboard">Open the traffic dashboard</a>}>
        <HStack gap={3} paddingX={4} paddingY={3}>
          <Box color="orange.fg" display="flex">
            <BarChart3 size={20} />
          </Box>
          <VStack align="start" gap={0} minWidth={0}>
            <Text textStyle="sm" fontWeight="medium">
              Traffic
            </Text>
            <Text textStyle="caption" color="fg.muted">
              12 widgets
            </Text>
          </VStack>
        </HStack>
      </Card>
      <Card
        padding="none"
        title="Named by its title"
        opener={createElement("a", { href: "#second", "aria-label": undefined })}
      >
        <Box paddingX={4} paddingY={3}>
          <Text textStyle="sm">The title names the link.</Text>
        </Box>
      </Card>
      <Card padding="none" opener={<button aria-label="Create a dashboard" />} placeholder>
        <Box paddingX={4} paddingY={3}>
          <Text textStyle="sm">A button opener never submits a form.</Text>
        </Box>
      </Card>
    </CardGrid>
  ),
};

export const InvalidFrame: Story = {
  args: { variant: "frame", invalid: true, children: createElement(Text, null, "Pick a target") },
};

export const JoinedPanels: Story = {
  render: () =>
    createElement(
      HStack,
      { gap: 0, height: "200px", align: "stretch" },
      createElement(Card, { variant: "joined-panel", edge: "start" }, "Inputs"),
      createElement(Card, { variant: "joined-panel", edge: "end" }, "Outputs"),
    ),
};

export const NestedMutedExtraSmall: Story = {
  args: {
    variant: "nested",
    padding: "xs",
    borderTone: "muted",
    children: createElement(Text, null, "Error detail"),
  },
};

export const BandedTones: StoryObj = {
  render: () => (
    <CardGrid columns={3}>
      {(["blue", "purple", "teal", "amber", "pink", "gray"] as const).map((tone) => (
        <Card key={tone} variant="banded" bandTone={tone} title={tone}>
          <Text textStyle="sm">Informational group</Text>
        </Card>
      ))}
    </CardGrid>
  ),
};

export const PanelFill: StoryObj = {
  render: () => (
    <Box height="240px">
      <Card variant="panel-fill" padding="lg" bodyLayout="stack" title="Chat">
        <Box overflowY="auto" flex={1}>
          <Box height="600px">Long inert transcript</Box>
        </Box>
      </Card>
    </Box>
  ),
};

export const ImageFrame: StoryObj = {
  render: () => (
    <Box maxWidth="360px">
      <Card variant="image-frame">
        <img
          alt="Wide setup screenshot"
          style={{ display: "block", maxWidth: "100%", maxHeight: "160px", objectFit: "contain" }}
          src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='200'%3E%3Crect width='800' height='200' fill='%23ccc'/%3E%3C/svg%3E"
        />
      </Card>
    </Box>
  ),
};
