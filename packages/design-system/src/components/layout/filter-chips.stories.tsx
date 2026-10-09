import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { FilterChips } from "./filter-chips.tsx";

const meta = {
  title: "Components/FilterChips",
  component: FilterChips,
  tags: ["autodocs"],
  args: {
    value: "7",
    onChange: () => void 0,
    groupLabel: "Time range",
    items: [
      { value: "1", label: "Last 24h" },
      { value: "7", label: "Last 7 days" },
      { value: "30", label: "Last 30 days" },
    ],
  },
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return <FilterChips {...args} value={value} onChange={setValue} />;
  },
} satisfies Meta<typeof FilterChips>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Presets: Story = {};

export const WithCounts: Story = {
  args: {
    value: "all",
    groupLabel: "Filter people by how they got here",
    countNoun: { singular: "person", plural: "people" },
    items: [
      { value: "all", label: "Everyone", count: 12 },
      { value: "invited", label: "Invited", count: 3 },
      { value: "requests", label: "Requests", count: 1 },
    ],
  },
};
