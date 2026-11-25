import { Box, Button, Input, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Building2 } from "lucide-react";

import { SettingsSection } from "../layout/settings-section.tsx";
import { Drawer } from "../overlays/drawer.tsx";
import { SettingsField, SettingsFieldGroup, SettingsFieldValue } from "./settings-field.tsx";
import { Switch } from "./switch.tsx";

const meta = {
  title: "Inputs and forms/Settings field",
  parameters: {
    usage: {
      use: "Every labelled field in a form. Inline (label left) on a settings page; stacked inside a Drawer or Dialog, which choose it for you. The hint is one sentence; the error sits under the control. A section's Save goes in SettingsSection `actions` and is disabled only while saving, never before input (ADR-018). A switch saves on change: no Save for a section of switches.",
      avoid:
        "Horizontal or Vertical form control with padding, border or label overrides; SmallLabel as a form label; a Save button under every field.",
    },
  },
  component: SettingsField,
  tags: ["autodocs"],
  args: {
    label: "Organization name",
    hint: "Shown in the switcher and on invoices.",
    children: <Input defaultValue="Acme" />,
  },
  argTypes: {
    layout: { control: "inline-radio", options: ["inline", "stacked"] },
    children: { control: false },
  },
} satisfies Meta<typeof SettingsField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inline: Story = {};

export const Stacked: Story = { args: { layout: "stacked" } };

export const WithError: Story = {
  args: { error: "Enter a name between 2 and 64 characters.", required: true },
};

/** A settings page: Save in the section's actions, switches beside it autosave. */
export const SettingsPage: Story = {
  render: () => (
    <Box maxWidth="800px">
      <SettingsSection
        icon={<Building2 size={18} />}
        title="Organization"
        hint="How your organization appears to members."
        actions={<Button size="sm">Save</Button>}
      >
        <SettingsFieldGroup>
          <SettingsField label="Name" hint="Shown in the switcher and on invoices." required>
            <Input defaultValue="Acme" />
          </SettingsField>
          <SettingsField label="Slug" hint="Part of every URL; it can't change.">
            <SettingsFieldValue>acme-inc</SettingsFieldValue>
          </SettingsField>
        </SettingsFieldGroup>
      </SettingsSection>
      <SettingsSection title="Notifications" hint="Each switch saves as you flip it.">
        <SettingsFieldGroup>
          <SettingsField
            label="Weekly digest"
            hint="A summary of usage every Monday."
            controlAlign="end"
          >
            <Switch defaultChecked aria-label="Weekly digest" />
          </SettingsField>
        </SettingsFieldGroup>
      </SettingsSection>
    </Box>
  ),
};

/** Inside a drawer the same fields stack without a prop. */
export const InDrawer: Story = {
  render: () => (
    <Drawer.Root open size="md">
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Drawer.Title>New team</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <SettingsFieldGroup>
            <SettingsField label="Name" required>
              <Input placeholder="Platform" />
            </SettingsField>
            <SettingsField label="Description" hint="What the team works on.">
              <Input />
            </SettingsField>
          </SettingsFieldGroup>
        </Drawer.Body>
        <Drawer.Actions primary={<Button colorPalette="orange">Create team</Button>} />
      </Drawer.Content>
    </Drawer.Root>
  ),
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Stack maxWidth="320px">
      <SettingsField {...args} />
    </Stack>
  ),
};
