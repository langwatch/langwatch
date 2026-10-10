import { Box, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Banner, BannerAction } from "./banner.tsx";

const meta = {
  title: "Components/Banner",
  component: Banner,
  tags: ["autodocs"],
  args: {
    status: "warning",
    title: "Evaluations and workflows are off.",
    children: "Set LANGWATCH_NLP_SERVICE and LANGEVALS_ENDPOINT to turn them on.",
  },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Flush in the top of the content panel: square top and right, the bottom-left curved. */
export const Top: Story = {
  args: { placement: "top", action: <BannerAction>Read the setup guide</BannerAction> },
  render: (args) => (
    <Box borderTopLeftRadius="xl" borderWidth="1px" overflow="hidden" bg="bg.surface" height="48">
      <Banner {...args} onDismiss={() => void 0} />
      <Banner status="error" placement="top" title="You've used every seat on your plan.">
        New members can't join until you add seats.
      </Banner>
    </Box>
  ),
};

/** A rounded card inside content, one per status. */
export const Inline: Story = {
  render: () => (
    <Stack gap="3" maxWidth="2xl">
      <Banner status="info" title="Copy this token now.">
        It won't be shown again.
      </Banner>
      <Banner status="success" title="Upgrade complete." onDismiss={() => void 0}>
        Every step ran.
      </Banner>
      <Banner status="warning" title="Sample data" action={<BannerAction>Turn off</BannerAction>}>
        Every figure on this page is invented.
      </Banner>
      <Banner status="error" title="Sign in with your organization's single sign-on">
        Sign out, then sign in again with your work email address.
      </Banner>
    </Stack>
  ),
};

export const LongText: Story = {
  args: {
    placement: "inline",
    children:
      "A sentence long enough to wrap onto a second line in a narrow container, so the action and the dismiss button stay pinned to the first line while the text flows underneath.",
    action: <BannerAction>Open</BannerAction>,
    onDismiss: () => void 0,
  },
  render: (args) => (
    <Box maxWidth="sm">
      <Banner {...args} />
    </Box>
  ),
};
