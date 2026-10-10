import { Badge, Box, HStack, Spacer, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { PageHeadingSizeProvider, PageLayout } from "./page-layout.tsx";

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
