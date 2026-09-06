import { Box, HStack, Spacer, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageLayout } from "./page-layout";

const meta = {
  title: "Patterns/Page layout",
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
        <PageLayout.HeaderButton>New prompt</PageLayout.HeaderButton>
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
          <PageLayout.HeaderButton>New dataset</PageLayout.HeaderButton>
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
