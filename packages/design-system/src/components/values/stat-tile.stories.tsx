import { Badge } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Users } from "lucide-react";

import { StatTile, StatTileFigure, StatTileGrid, StatTileSkeleton } from "./stat-tile.tsx";

const meta = {
  title: "Components/Stat tile",
  component: StatTile,
  tags: ["autodocs"],
  args: {
    label: "Team members",
    icon: <Users size={14} />,
    children: <StatTileFigure>4 / 100</StatTileFigure>,
  },
} satisfies Meta<typeof StatTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A figure against a limit shows its share as a bar; at the limit the bar turns red. */
export const WithMeter: Story = {
  args: { meter: { current: 4, max: 100 } },
};

export const AtTheLimit: Story = {
  args: {
    children: <StatTileFigure>100 / 100</StatTileFigure>,
    meter: { current: 100, max: 100 },
  },
};

export const WithHint: Story = {
  args: { hint: "Seats in use across the whole organization, lite members not counted." },
};

/** Anything can stand in for the figure: a chip, or a muted phrase. */
export const ChipInPlaceOfFigure: Story = {
  args: { label: "Plan", children: <Badge>Enterprise</Badge> },
};

export const Grid: Story = {
  render: () => (
    <StatTileGrid columns={3}>
      <StatTile label="Team members" meter={{ current: 4, max: 100 }}>
        <StatTileFigure>4 / 100</StatTileFigure>
      </StatTile>
      <StatTile label="Lite members">
        <StatTileFigure>0 / 50</StatTileFigure>
      </StatTile>
      <StatTile label="Traces / month">
        <StatTileFigure>184</StatTileFigure>
      </StatTile>
    </StatTileGrid>
  ),
};

export const Loading: Story = {
  render: () => <StatTileSkeleton columns={3} />,
};
