import { Button, Input, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bell, Building2 } from "lucide-react";

import { HorizontalFormControl } from "../components/forms/horizontal-form-control.tsx";
import { Switch } from "../components/forms/switch.tsx";
import { OverviewCard, OverviewDetail } from "../components/layout/settings-card.tsx";
import { SettingsSection } from "../components/layout/settings-section.tsx";

const meta = {
  title: "Patterns/Settings page",
  parameters: {
    usage: {
      use: "Any settings page: one Settings section per concern, horizontal form controls inside it, Settings cards for the state of a connected thing, and a switch where a change takes effect at once.",
      avoid:
        "Hand-drawn section headings, a save button for a switch, or form fields laid out with their own margins.",
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Stack gap={10} maxWidth="56rem">
      <SettingsSection
        icon={<Building2 size={18} />}
        title="Organization"
        hint="How your organization is named across LangWatch."
        actions={<Button size="sm">Save</Button>}
      >
        <Stack gap={4}>
          <HorizontalFormControl label="Name" helper="Shown in the switcher and on invitations.">
            <Input defaultValue="Acme Robotics" />
          </HorizontalFormControl>
          <HorizontalFormControl
            label="Slug"
            helper="Part of every address in this organization."
            invalid
            error="Use lowercase letters, numbers and dashes."
          >
            <Input defaultValue="Acme Robotics" />
          </HorizontalFormControl>
        </Stack>
      </SettingsSection>
      <SettingsSection
        icon={<Bell size={18} />}
        title="Notifications"
        hint="Takes effect as soon as you flip it."
      >
        <HorizontalFormControl
          label="Weekly digest"
          helper="A summary of traces and evaluations every Monday."
        >
          <Switch defaultChecked aria-label="Weekly digest" />
        </HorizontalFormControl>
      </SettingsSection>
      <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
        <OverviewCard
          title="Single sign-on"
          chip={{ label: "Active", tone: "good", title: "Signing people in." }}
          actions={
            <Button size="sm" variant="outline">
              Configure
            </Button>
          }
        >
          <OverviewDetail label="Provider">
            <Text>Okta</Text>
          </OverviewDetail>
        </OverviewCard>
        <OverviewCard
          title="Directory"
          chip={{
            label: "Not connected",
            tone: "neutral",
            title: "No directory pushes people here yet.",
          }}
        >
          <OverviewDetail label="Members it manages">
            <Text>None</Text>
          </OverviewDetail>
        </OverviewCard>
      </SimpleGrid>
    </Stack>
  ),
};
