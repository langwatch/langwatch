import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bot, MoreHorizontal } from "lucide-react";

import { Badge, IconButton } from "../../primitives.ts";
import { CardGrid } from "./card.tsx";
import { ResourceTile } from "./resource-tile.tsx";

const meta = {
  title: "Data display/Resource tile",
  parameters: {
    usage: {
      use: "A resource that opens on click, laid out in a CardGrid: workflows, agents, evaluators, pickable role cards. Pass the native link or button as `opener`; it stretches under the menu and badges.",
      avoid:
        "A tile that opens nothing: use Card. A div with onClick: pass a real `<a>` or `<button>`. Restyling the tile's height or shadow.",
    },
  },
  component: ResourceTile,
  tags: ["autodocs"],
  args: {
    icon: <Bot size={24} />,
    title: "Support bot",
    description: "Answers billing questions and hands off to a person when unsure.",
    meta: "Updated 3 days ago",
    opener: <button type="button" aria-label="Open Support bot" />,
    menu: (
      <IconButton aria-label="More actions" variant="ghost" size="xs">
        <MoreHorizontal />
      </IconButton>
    ),
  },
} satisfies Meta<typeof ResourceTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithBadges: Story = { args: { badges: <Badge>HTTP</Badge> } };

export const Selected: Story = { args: { selected: true, menu: undefined } };

export const LongText: Story = {
  args: {
    title: "An agent with a name long enough to be cut off at the tile's edge",
    description: "A description long enough to run past two lines, so the clamp shows. ".repeat(3),
  },
};

export const InAGrid: Story = {
  render: (args) => (
    <CardGrid columns={3}>
      <ResourceTile {...args} />
      <ResourceTile {...args} title="Billing triage" description={undefined} />
      <ResourceTile {...args} title="Release notes writer" selected />
    </CardGrid>
  ),
};
