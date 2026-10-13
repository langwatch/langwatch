import { Box, SimpleGrid, Stack, Text, Theme } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Banner, BannerAction } from "./banner.tsx";

const meta = {
  title: "Feedback/Banner",
  parameters: {
    usage: {
      use: "A notice heading a page or panel: a missing configuration, a limit reached. New notices use it.",
      avoid: "Inside a form: Alert. Something that just happened: Toaster.",
    },
  },
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
    <Box borderWidth="1px" borderColor="border.muted" bg="bg.panel" minHeight="48">
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
      "A sentence long enough to wrap onto a second line in a narrow container, so the action moves below the copy when space is tight and the dismiss stays at the top.",
    action: <BannerAction>Open</BannerAction>,
    onDismiss: () => void 0,
  },
  render: (args) => (
    <Box maxWidth="sm">
      <Banner {...args} />
    </Box>
  ),
};

const statuses = ["info", "warning", "error", "success"] as const;

/** Compare every status and placement in the same light and dark surroundings. */
export const AllStates: Story = {
  render: () => (
    <SimpleGrid columns={{ base: 1, xl: 2 }} gap="6">
      {(["light", "dark"] as const).map((mode) => (
        <Theme key={mode} appearance={mode} colorPalette="gray">
          <Stack bg="bg" color="fg" padding="4" gap="6">
            <Text fontWeight="medium">{mode === "light" ? "Light" : "Dark"}</Text>
            {statuses.map((status) => (
              <Stack key={status} gap="3">
                <Text textStyle="xs" color="fg.muted">
                  {status}
                </Text>
                <Box bg="bg.panel" borderWidth="1px" borderColor="border.muted">
                  <Box paddingX="6" paddingY="3" borderBottomWidth="1px" borderColor="border.muted">
                    <Text fontWeight="medium">Page heading</Text>
                  </Box>
                  <Banner status={status} placement="top">
                    A notice without a title or controls.
                  </Banner>
                  <Banner
                    status={status}
                    placement="top"
                    title="Connection needs attention."
                    action={<BannerAction>Review</BannerAction>}
                    onDismiss={() => void 0}
                  >
                    Review the settings before your next run. This longer message wraps naturally
                    across lines.
                  </Banner>
                  <Text padding="6" color="fg.muted">
                    Page content continues here.
                  </Text>
                </Box>
                <Banner status={status}>A notice without a title or controls.</Banner>
                <Banner
                  status={status}
                  title="Connection needs attention."
                  action={<BannerAction>Review</BannerAction>}
                  onDismiss={() => void 0}
                >
                  Review the settings before your next run. This longer message wraps naturally
                  across lines.
                </Banner>
                <Banner status={status} title="A title alone." onDismiss={() => void 0} />
                <Banner status={status} action={<BannerAction>Review settings</BannerAction>}>
                  A message with an action and no title.
                </Banner>
              </Stack>
            ))}
          </Stack>
        </Theme>
      ))}
    </SimpleGrid>
  ),
};
