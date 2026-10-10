import { Badge, Box, HStack, Spacer, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

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
            actions={<PageLayout.HeaderButton disabled>Export</PageLayout.HeaderButton>}
          >
            <Stack gap={0.5} minWidth={0}>
              <PageLayout.Heading>Costs</PageLayout.Heading>
              <PageLayout.Subtitle>Usage across your organization</PageLayout.Subtitle>
            </Stack>
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
      if (row.height !== 64 || box.left - row.left !== 24 || box.top - row.top !== 18) {
        throw new Error(
          `Header moved: ${row.height}, ${box.left - row.left}, ${box.top - row.top}`,
        );
      }
      for (const button of header.querySelectorAll("button")) {
        if (button.getBoundingClientRect().height !== 36) throw new Error("Header button resized");
      }
    }
    const rail = canvasElement.querySelector('[data-testid="section-navigation-title"]');
    if (!rail || rail.getBoundingClientRect().height !== 64) throw new Error("Rail title resized");
  },
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
