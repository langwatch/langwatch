import { Card, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { CardTitle, Eyebrow, MetaText, SectionTitle } from "./typography.tsx";

const meta = {
  title: "Foundations/Text primitives",
  parameters: {
    usage: {
      use: "SectionTitle for a heading inside a page or drawer, CardTitle for a card's title, Eyebrow over a group of items, MetaText for timestamps, counts and ids beside a line.",
      avoid:
        "A `fontSize` in pixels or an ad hoc weight: every other line takes a `textStyle` from Foundations/Typography.",
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const InASettingsCard: Story = {
  render: () => (
    <Stack gap={6} maxWidth="40rem">
      <SectionTitle>Access</SectionTitle>
      <Card.Root>
        <Card.Body gap={1}>
          <Eyebrow>Single sign-on</Eyebrow>
          <CardTitle>Okta</CardTitle>
          <MetaText>Connected 3 days ago</MetaText>
          <MetaText mono>idp_7f3c9a20</MetaText>
        </Card.Body>
      </Card.Root>
    </Stack>
  ),
};

export const EyebrowCuts: Story = {
  render: () => (
    <Stack gap={3}>
      <Eyebrow>Sentence case, for navigation and menus</Eyebrow>
      <Eyebrow uppercase>Uppercase, for a label above a value</Eyebrow>
    </Stack>
  ),
};
