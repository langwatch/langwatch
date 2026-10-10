import { Button, Card, HStack, SimpleGrid, Stack, Text, Theme } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronRight } from "lucide-react";

import { ProviderScopeChips } from "../scope/provider-scope-chips.tsx";
import {
  OverviewCard,
  OverviewDetail,
  SettingItem,
  SettingList,
  StatusChip,
} from "./settings-card.tsx";

const meta = {
  title: "Navigation and layout/Settings card",
  parameters: {
    usage: {
      use: "One card of settings with a status, facts as name and value rows, and actions.",
      avoid: "Many rows of the same kind: use List table.",
    },
  },
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

export const ConnectionList: Story = {
  render: () => (
    <SimpleGrid columns={{ base: 1, lg: 2 }} gap="6">
      {(["light", "dark"] as const).map((mode) => (
        <Theme key={mode} appearance={mode} colorPalette="gray">
          <Stack bg="bg.page" padding="6" color="fg">
            <Card.Root bg="bg.card" borderColor="border.card">
              <Card.Body gap="3">
                <Text fontWeight="medium">Connections</Text>
                <Text textStyle="sm" color="fg.muted">
                  Connections available to this project.
                </Text>
                <SettingList>
                  {[
                    "Production alerts",
                    "A longer connection name that wraps in a narrow card",
                    "Release updates",
                  ].map((name, index) => (
                    <SettingItem key={name} as="button">
                      <HStack gap="4" justify="space-between">
                        <Stack minWidth={0} gap="1">
                          <HStack flexWrap="wrap" gap="2">
                            <Text textStyle="sm" fontWeight="medium">
                              {name}
                            </Text>
                            <Text textStyle="xs" color="fg.muted">
                              {index ? "Bot" : "Webhook"}
                            </Text>
                            <ProviderScopeChips
                              size="sm"
                              tone="neutral"
                              scopes={[
                                { scopeType: "PROJECT", scopeId: "example", name: "This project" },
                              ]}
                            />
                          </HStack>
                          <Text textStyle="xs" color="fg.muted">
                            Workspace connection
                          </Text>
                        </Stack>
                        <HStack color="fg.muted" flexShrink={0}>
                          <Text
                            textStyle="xs"
                            maxWidth={{ base: "28", md: "none" }}
                            textAlign="end"
                          >
                            Used by {index + 1} automations
                          </Text>
                          <ChevronRight size={16} />
                        </HStack>
                      </HStack>
                    </SettingItem>
                  ))}
                </SettingList>
              </Card.Body>
            </Card.Root>
          </Stack>
        </Theme>
      ))}
    </SimpleGrid>
  ),
};
