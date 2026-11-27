import { HStack, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { AggregateProjectAvatar, ProjectAvatar } from "./project-avatar.tsx";

const meta = {
  title: "Data display/Project avatar",
  parameters: {
    usage: {
      use: "A project beside its name: switchers, pickers, team and braid rows.",
      avoid: "A person or an organization: use Avatar or UserAvatar.",
    },
  },
  component: ProjectAvatar,
  tags: ["autodocs"],
  args: { name: "Payments agent" },
  argTypes: { size: { control: "inline-radio", options: ["xs", "sm", "md"] } },
} satisfies Meta<typeof ProjectAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Medium: Story = { args: { size: "md" } };

/** Beside a dense line, such as a span in a trace tree. */
export const ExtraSmall: Story = { args: { size: "xs" } };

/** A leading emoji is kept whole, flags and families included. */
export const EmojiNames: Story = {
  render: () => (
    <HStack gap="2">
      <ProjectAvatar name="🏭 Background jobs" />
      <ProjectAvatar name="🇳🇱 Netherlands" />
      <ProjectAvatar name="Engineering" />
    </HStack>
  ),
};

/** Each name keeps its own hue, the same wherever the project appears. */
export const Hues: Story = {
  render: () => (
    <Stack gap="2">
      {["Web app", "Payments agent", "Search agent", "Support bot", "Billing"].map((name) => (
        <HStack key={name} gap="2">
          <ProjectAvatar name={name} />
          <Text textStyle="sm">{name}</Text>
        </HStack>
      ))}
    </Stack>
  ),
};

/** An aggregate project: its bubble before a fainter one, like an avatar group. */
export const Aggregate: Story = {
  render: () => (
    <HStack gap="2" paddingLeft="3">
      <AggregateProjectAvatar name="All production" />
      <Text textStyle="sm">All production</Text>
    </HStack>
  ),
};

/** A narrow row: the bubble keeps its size and the name truncates. */
export const Narrow: Story = {
  render: () => (
    <HStack gap="2" width="32" minWidth={0}>
      <ProjectAvatar name="A project with a very long name" />
      <Text textStyle="sm" truncate>
        A project with a very long name
      </Text>
    </HStack>
  ),
};
