import { Box, Button, IconButton, Spacer, Stack, Text } from "@chakra-ui/react";
import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import {
  Calendar,
  Eye,
  Folder,
  FolderCode,
  Hash,
  Inbox,
  KeyRound,
  MoreVertical,
  PanelRightOpen,
  Plug,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";

import { PageLayout } from "./page-layout.tsx";
import { SectionNavigationFrame } from "./section-navigation-frame.tsx";

/** Stands in for the shell's page card: a fixed-height column that scrolls, as the app gives it. */
const InShellCard: Decorator = (Story) => (
  <Box
    height="100vh"
    display="flex"
    flexDirection="column"
    overflowY="auto"
    background="bg.surface"
    borderTopLeftRadius="xl"
    borderTopWidth="1px"
    borderLeftWidth="1px"
    borderColor="border"
  >
    <Story />
  </Box>
);

const header = (title: string) => (
  <PageLayout.Header>
    <PageLayout.Heading>{title}</PageLayout.Heading>
  </PageLayout.Header>
);

const paragraphs = (count: number) => (
  <Stack gap={4}>
    {Array.from({ length: count }, (_, index) => (
      <Box key={index} borderWidth="1px" borderColor="border.muted" borderRadius="lg" padding={4}>
        <Text fontWeight="medium">Block {index + 1}</Text>
        <Text color="fg.muted">A row of the page, long enough to need the card to scroll.</Text>
      </Box>
    ))}
  </Stack>
);

const meta = {
  title: "Chrome and app shell/Section navigation frame",
  component: SectionNavigationFrame,
  tags: ["autodocs"],
  decorators: [InShellCard],
  parameters: {
    usage: {
      use: "A rail of sections beside a page, shared by pages of different modules (ARCHITECTURE.md, ruled 2026-09-28).",
      avoid: "Two to four views of the same content: use Segmented control.",
    },
    layout: "fullscreen",
  },
  args: {
    label: "Automations",
    header: header("Reports"),
    links: [
      { label: "Overview", href: "/automations", icon: <Eye size={14} /> },
      { label: "Automations", href: "/automations/automations", icon: <Zap size={14} /> },
      { label: "Reports", href: "/automations/schedules", icon: <Calendar size={14} /> },
    ],
    activeHref: "/automations/schedules",
    onNavigate: () => {},
    children: <Text>Send a dashboard, graph, or trace table on a recurring schedule.</Text>,
  },
} satisfies Meta<typeof SectionNavigationFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A page shorter than the card: the rail still runs to the card's bottom edge. */
export const ShortContent: Story = {};

/** A page taller than the card: the content column scrolls, header included; the rail stays put. */
export const LongContent: Story = {
  args: { children: paragraphs(30) },
};

export const EmptyState: Story = {
  args: {
    children: (
      <Box
        borderWidth="1px"
        borderStyle="dashed"
        borderColor="border"
        borderRadius="lg"
        padding={8}
        textAlign="center"
      >
        <Text color="fg.muted">No reports yet. Create one for a recurring digest.</Text>
      </Box>
    ),
  },
};

/** More entries than the card is tall, in labelled runs. */
export const ManyItems: Story = {
  args: {
    label: "Analytics",
    links: [{ label: "Overview", href: "/a", icon: <Eye size={14} /> }],
    groups: [
      {
        label: "Engagement",
        links: Array.from({ length: 12 }, (_, index) => ({
          label: `Engagement view ${index + 1}`,
          href: `/a/e${index}`,
          icon: <Users size={14} />,
        })),
      },
      {
        label: "Custom",
        links: Array.from({ length: 14 }, (_, index) => ({
          label: `A custom dashboard with a long name ${index + 1}`,
          href: `/a/c${index}`,
          icon: <Hash size={14} />,
        })),
      },
    ],
    activeHref: "/a/e3",
    header: header("Engagement view 4"),
  },
};

/** The page header already names the section, so the rail drops its title. */
export const WithoutTitle: Story = {
  args: { hideTitle: true },
};

export const HeaderWithActions: Story = {
  args: {
    label: "Authentication",
    links: [
      { label: "Overview", href: "/auth", icon: <ShieldCheck size={14} /> },
      { label: "Identity provider", href: "/auth/provider", icon: <KeyRound size={14} /> },
      { label: "Connectors", href: "/auth/connectors", icon: <Plug size={14} /> },
    ],
    activeHref: "/auth/connectors",
    header: (
      <PageLayout.Header>
        <PageLayout.Heading>Connectors</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton>Docs</PageLayout.HeaderButton>
        <PageLayout.HeaderButton primary>Add connector</PageLayout.HeaderButton>
      </PageLayout.Header>
    ),
    children: paragraphs(4),
  },
};

/** Below `md` the rail is a strip of links over the content. */
export const Mobile: Story = {
  args: { children: paragraphs(8) },
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

export const Dark: Story = {
  args: { children: paragraphs(30) },
  globals: { colorMode: "dark" },
};

const rowMenu = (name: string) => (
  <IconButton size="2xs" variant="ghost" aria-label={`Actions for ${name}`}>
    <MoreVertical size={13} />
  </IconButton>
);
const suite = (name: string) => ({
  label: name,
  href: `/testing/suites/${name.toLowerCase()}`,
  icon: <Folder size={14} />,
  actions: rowMenu(name),
});
const railFooter = (
  <Stack direction="row" alignItems="center" paddingX={2} paddingTop={2}>
    <Button size="xs" variant="outline">
      30d
    </Button>
    <Spacer />
    <IconButton size="xs" variant="ghost" aria-label="Collapse the rail">
      <PanelRightOpen size={14} />
    </IconButton>
  </Stack>
);

/** Entries with a row menu under the pointer, a create action under the run, and a footer. */
export const RowActionsAndFooter: Story = {
  args: {
    label: "Test Suites",
    header: header("Refunds"),
    links: [],
    groups: [
      {
        links: [suite("Default"), suite("Refunds"), suite("Checkout")],
        add: { label: "New Test Suite", onClick: () => {} },
      },
      {
        label: "From Code",
        links: [
          {
            label: "nightly-ci",
            href: "/testing/external/nightly-ci",
            icon: <FolderCode size={14} />,
          },
        ],
      },
    ],
    activeHref: "/testing/suites/refunds",
    footer: railFooter,
  },
};

/** Trailing counts that give way to the row menu under the pointer. */
export const WithCounts: Story = {
  args: {
    label: "Annotations",
    header: header("Inbox"),
    links: [
      { label: "Inbox", href: "/annotations", icon: <Inbox size={14} />, badge: 12 },
      { label: "All", href: "/annotations/all", icon: <Hash size={14} /> },
    ],
    groups: [
      {
        label: "My Queues",
        links: [
          {
            label: "Support",
            href: "/annotations/support",
            icon: <Users size={14} />,
            badge: 3,
            actions: rowMenu("Support"),
          },
        ],
        add: { label: "New Queue", onClick: () => {} },
      },
    ],
    activeHref: "/annotations",
  },
};

/** Folded to its icons: each entry keeps its label as its name and title. */
export const Collapsed: Story = {
  args: { ...RowActionsAndFooter.args, collapsed: true },
};
