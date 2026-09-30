import { Button, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { BrandedCard, BrandedCardPage } from "./branded-card.tsx";

const meta = {
  title: "Components/Branded card",
  component: BrandedCard,
  tags: ["autodocs"],
  args: {
    title: "Link not valid",
    intro: "This unsubscribe link is invalid or has expired.",
    children: <Text textAlign="center">Ask for a fresh link and try again.</Text>,
  },
  decorators: [
    (Story) => (
      <BrandedCardPage>
        <Story />
      </BrandedCardPage>
    ),
  ],
} satisfies Meta<typeof BrandedCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = {
  args: { title: "Authorise the command line", children: <Button>Continue</Button> },
};
