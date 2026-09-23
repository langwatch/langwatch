import { Button, SimpleGrid, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { OverviewCard, OverviewDetail, StatusChip } from "./settings-card.tsx";

const meta = {
  title: "Components/Settings card",
  component: OverviewCard,
  tags: ["autodocs"],
  args: {
    title: "Directory",
    chip: {
      label: "Syncing",
      tone: "good",
      title: "Your identity provider is creating people here.",
    },
    children: null,
  },
} satisfies Meta<typeof OverviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <OverviewCard {...args} actions={<Button size="sm">See who it manages</Button>}>
      <OverviewDetail label="Members it manages" hint="1 arrived another way.">
        <Text>3 of 4</Text>
      </OverviewDetail>
      <OverviewDetail label="Last directory change">
        <Text>5 min ago</Text>
      </OverviewDetail>
    </OverviewCard>
  ),
};

/** Two cards side by side stretch to the taller one; the actions sit under the facts. */
export const SideBySide: Story = {
  render: (args) => (
    <SimpleGrid columns={2} gap={4} maxWidth="900px">
      <OverviewCard
        title="OpenID Connect single sign-on"
        chip={{ label: "Active", tone: "good", title: "Signing people in." }}
      >
        <OverviewDetail label="Sign-in">
          <StatusChip label="Everybody" tone="good" />
        </OverviewDetail>
      </OverviewCard>
      <OverviewCard {...args}>
        <OverviewDetail label="Members it manages">
          <Text>3 of 4</Text>
        </OverviewDetail>
      </OverviewCard>
    </SimpleGrid>
  ),
};
