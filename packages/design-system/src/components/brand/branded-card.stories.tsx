import { Button, Input, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { BrandedCard, BrandedCardPage } from "./branded-card.tsx";

const meta = {
  title: "Components/Branded card",
  component: BrandedCard,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
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

/** Taller than the viewport: it starts 48px down and the page scrolls over the fixed ground. */
export const Tall: Story = {
  args: {
    title: "Create a project",
    intro: "Name it and pick the stack it runs on.",
    size: "wide",
    children: (
      <>
        {Array.from({ length: 14 }, (_, index) => (
          <Input key={index} placeholder={`Field ${index + 1}`} />
        ))}
        <Button>Next</Button>
      </>
    ),
  },
};
