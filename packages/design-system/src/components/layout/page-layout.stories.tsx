import { Badge, Box, HStack, Spacer, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Menu } from "../overlays/menu.tsx";
import { PageHeaderSizeProvider, PageHeadingSizeProvider, PageLayout } from "./page-layout.tsx";
import { SectionNavigationFrame } from "./section-navigation-frame.tsx";

const meta = {
  title: "Navigation and layout/Page layout",
  parameters: {
    usage: {
      use: "Every product page: the container, header, title and actions.",
      avoid: "A standalone branded page such as sign-in: use Branded card.",
    },
  },
  component: PageLayout.Container,
  tags: ["autodocs"],
  argTypes: { children: { control: false } },
} satisfies Meta<typeof PageLayout.Container>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" overflow="hidden">
      <PageLayout.Header>
        <PageLayout.Heading>Prompts</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton primary>New prompt</PageLayout.HeaderButton>
      </PageLayout.Header>
      <PageLayout.Container {...args} sidebarWidth={0}>
        <PageLayout.Content>
          <Text>Every prompt in this project.</Text>
        </PageLayout.Content>
      </PageLayout.Container>
    </Box>
  ),
};

/** One centred reading column, such as a section's overview: the body sets the measure. */
export const NarrowBody: Story = {
  render: () => (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" overflow="hidden">
      <PageLayout.Header>
        <PageLayout.Heading>AI Governance</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container width="narrow">
        <PageLayout.Content>
          <Text>
            A greeting, one field and two short lists read as one column, centred however wide the
            window is.
          </Text>
        </PageLayout.Content>
      </PageLayout.Container>
    </Box>
  ),
};

export const HeaderWithoutBorder: Story = {
  render: (args) => (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" overflow="hidden">
      <PageLayout.Header withBorder={false}>
        <PageLayout.Heading>Settings</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container {...args} sidebarWidth={0}>
        <PageLayout.Content>
          <Text>No rule under the title.</Text>
        </PageLayout.Content>
      </PageLayout.Container>
    </Box>
  ),
};

/** Several header actions, disabled while the page is still loading. */
export const HeaderActions: Story = {
  render: () => (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" overflow="hidden">
      <PageLayout.Header>
        <PageLayout.Heading>Datasets</PageLayout.Heading>
        <Spacer />
        <HStack gap="2">
          <PageLayout.HeaderButton disabled>Export</PageLayout.HeaderButton>
          <PageLayout.HeaderButton loading>Importing</PageLayout.HeaderButton>
          <PageLayout.HeaderButton primary>New dataset</PageLayout.HeaderButton>
        </HStack>
      </PageLayout.Header>
    </Box>
  ),
};

/** A link keeps its `href`, `target` and `rel`; the header paints it as a button. */
export const HeaderLink: Story = {
  render: () => (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" overflow="hidden">
      <PageLayout.Header
        actions={
          <>
            <PageLayout.HeaderButton asChild>
              <a href="/settings/billing">Billing</a>
            </PageLayout.HeaderButton>
            <PageLayout.HeaderButton asChild primary>
              <a href="https://langwatch.ai/pricing" target="_blank" rel="noreferrer">
                Talk to sales
              </a>
            </PageLayout.HeaderButton>
          </>
        }
      >
        <PageLayout.Heading>Subscription</PageLayout.Heading>
      </PageLayout.Header>
    </Box>
  ),
};

/** A menu opens from the header button and the button reports `aria-expanded`. */
export const HeaderMenu: Story = {
  render: () => (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" overflow="hidden">
      <PageLayout.Header
        actions={
          <Menu.Root>
            <Menu.Trigger asChild>
              <PageLayout.HeaderButton primary data-testid="new-menu">
                New
              </PageLayout.HeaderButton>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item value="dataset">Dataset</Menu.Item>
              <Menu.Item value="prompt">Prompt</Menu.Item>
            </Menu.Content>
          </Menu.Root>
        }
      >
        <PageLayout.Heading>Library</PageLayout.Heading>
      </PageLayout.Header>
    </Box>
  ),
};

export const LongTitleAndNarrowWidth: Story = {
  render: () => (
    <Box
      maxWidth="320px"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      overflow="hidden"
    >
      <PageLayout.Header>
        <PageLayout.Heading>Organization members and invitations</PageLayout.Heading>
      </PageLayout.Header>
    </Box>
  ),
};

/** Compare the shared bar in both modes without changing route-owned title sizing. */
export const HeaderStates: Story = {
  render: () => (
    <HStack align="start" gap={6} wrap="wrap">
      {(["light", "dark"] as const).map((mode) => (
        <Stack
          key={mode}
          className={mode}
          color="fg"
          bg="bg.panel"
          width="480px"
          gap={4}
          paddingY={4}
        >
          <Text paddingX={6} color="fg.muted">
            {mode}
          </Text>
          <PageLayout.Header
            actions={<PageLayout.HeaderButton primary>Create key</PageLayout.HeaderButton>}
          >
            <PageLayout.Heading>Virtual Keys</PageLayout.Heading>
            <Badge variant="subtle">12</Badge>
          </PageLayout.Header>
          <PageLayout.Header
            description="Usage across your organization"
            actions={<PageLayout.HeaderButton disabled>Export</PageLayout.HeaderButton>}
          >
            <PageLayout.Heading>Costs</PageLayout.Heading>
          </PageLayout.Header>
          <PageLayout.Header
            withBorder={false}
            actions={<PageLayout.HeaderButton loading>Refreshing</PageLayout.HeaderButton>}
          >
            <PageLayout.Heading>Integrations</PageLayout.Heading>
          </PageLayout.Header>
          <PageHeadingSizeProvider size="lg">
            <PageLayout.Header>
              <PageLayout.Heading>Account settings</PageLayout.Heading>
            </PageLayout.Header>
          </PageHeadingSizeProvider>
          <Box width="320px">
            <PageLayout.Header actions={<PageLayout.HeaderButton>Invite</PageLayout.HeaderButton>}>
              <PageLayout.Heading>Organization members and invitations</PageLayout.Heading>
            </PageLayout.Header>
          </Box>
        </Stack>
      ))}
    </HStack>
  ),
};

/** Scroll either panel: the reserved hairline fades in without moving the title. */
export const ScrollingGlass: Story = {
  render: () => (
    <HStack align="start" gap={6} wrap="wrap">
      {(["light", "dark"] as const).map((mode) => (
        <Box
          key={mode}
          className={mode}
          bg="bg.surface"
          color="fg"
          width="480px"
          height="320px"
          overflowY="auto"
          borderWidth="1px"
          borderColor="border.card"
          borderRadius="lg"
        >
          <PageLayout.Header>
            <PageLayout.Heading>Integrations</PageLayout.Heading>
          </PageLayout.Header>
          <Stack padding={6} gap={4}>
            {Array.from({ length: 12 }, (_, index) => (
              <Box
                key={index}
                bg="bg.card"
                borderWidth="1px"
                borderColor="border.card"
                borderRadius="lg"
                padding={4}
              >
                <Text>Connection {index + 1}</Text>
                <Text color="fg.muted">Content scrolls underneath the title.</Text>
              </Box>
            ))}
          </Stack>
        </Box>
      ))}
    </HStack>
  ),
};

/** Real layout assertions: action count cannot change the title's position. */
export const HeaderGeometry: Story = {
  render: () => (
    <PageHeaderSizeProvider size="lg">
      <Stack width="1000px" gap={4}>
        {[0, 1, 5].map((count) => (
          <PageLayout.Header
            key={count}
            size="sm"
            actions={Array.from({ length: count }, (_, index) => (
              <PageLayout.HeaderButton key={index}>Action {index + 1}</PageLayout.HeaderButton>
            ))}
          >
            <PageLayout.Heading>Same title</PageLayout.Heading>
          </PageLayout.Header>
        ))}
        <SectionNavigationFrame
          label="Section"
          pageTitle="Same title"
          activeHref=""
          onNavigate={() => {}}
        >
          <Text>Content starts at the normal inset.</Text>
        </SectionNavigationFrame>
      </Stack>
    </PageHeaderSizeProvider>
  ),
  play: async ({ canvasElement }) => {
    await document.fonts.ready;
    const headers = canvasElement.querySelectorAll<HTMLElement>("[data-page-header]");
    if (headers.length !== 4) throw new Error("Expected four header variants");
    for (const header of headers) {
      const title = header.querySelector("h1");
      if (!title) throw new Error("Missing title");
      const row = header.getBoundingClientRect();
      const box = title.getBoundingClientRect();
      if (row.height !== 48 || box.left - row.left !== 24 || box.top - row.top !== 10) {
        throw new Error(
          `Header moved: ${row.height}, ${box.left - row.left}, ${box.top - row.top}`,
        );
      }
      for (const button of header.querySelectorAll("button")) {
        if (button.getBoundingClientRect().height !== 36) throw new Error("Header button resized");
      }
    }
    const rail = canvasElement.querySelector('[data-testid="section-navigation-title"]');
    if (!rail || rail.getBoundingClientRect().height !== 48) throw new Error("Rail title resized");
  },
};

/** A description sits 4px under the title; one line makes the header 77px, a wrapped one grows. */
export const DescribedHeader: Story = {
  render: () => (
    <PageHeaderSizeProvider size="lg">
      <Stack width="640px" gap={4}>
        <PageLayout.Header
          data-testid="short"
          description="What a role can do, and who holds one where."
          actions={<PageLayout.HeaderButton primary>New role</PageLayout.HeaderButton>}
        >
          <PageLayout.Heading>Roles &amp; access</PageLayout.Heading>
        </PageLayout.Header>
        <PageLayout.Header
          data-testid="wrapped"
          description="A long description wraps onto further lines and every extra line adds twenty pixels, so nothing is ever clipped, however large the reader's text is set."
        >
          <PageLayout.Heading>Directory</PageLayout.Heading>
        </PageLayout.Header>
      </Stack>
    </PageHeaderSizeProvider>
  ),
  play: async ({ canvasElement }) => {
    await document.fonts.ready;
    const header = canvasElement.querySelector<HTMLElement>('[data-testid="short"]');
    const title = header?.querySelector("h1");
    const line = header?.querySelector("[data-header-description]");
    if (!header || !title || !line) throw new Error("Missing described header");
    const row = header.getBoundingClientRect();
    const gap = line.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
    if (row.height !== 77 || gap !== 4) throw new Error(`Described header: ${row.height}, ${gap}`);
  },
};

/** In a 390px container the actions wrap below the description and a long title is cut. */
export const DescribedHeaderNarrow: Story = {
  render: () => (
    <PageHeaderSizeProvider size="lg">
      <Box maxWidth="390px">
        <PageLayout.Header
          description="Lets the Support assistant call models through the gateway."
          actions={
            <>
              <PageLayout.HeaderButton>Audit history</PageLayout.HeaderButton>
              <PageLayout.HeaderButton>View traces</PageLayout.HeaderButton>
              <PageLayout.HeaderButton>Revoke</PageLayout.HeaderButton>
            </>
          }
        >
          <PageLayout.Heading>Production support key for the payments gateway</PageLayout.Heading>
        </PageLayout.Header>
      </Box>
    </PageHeaderSizeProvider>
  ),
};

export const CompactTool: Story = {
  render: () => (
    <PageHeaderSizeProvider size="sm">
      <PageLayout.Header actions={<PageLayout.HeaderButton>Run</PageLayout.HeaderButton>}>
        <PageLayout.Heading>Workflow studio</PageLayout.Heading>
      </PageLayout.Header>
    </PageHeaderSizeProvider>
  ),
};
