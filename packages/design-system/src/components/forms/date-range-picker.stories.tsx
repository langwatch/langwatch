import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { DateRangePicker } from "./date-range-picker.tsx";

const presets = [
  { key: "1h", label: "Last 1 hour" },
  { key: "24h", label: "Last 24 hours" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
] as const;

const meta = {
  title: "Inputs and forms/Date range picker",
  parameters: {
    usage: {
      use: "Choosing the range a page is drawn over: a preset or a custom start and end.",
      avoid: "A single date: use an Input of type date.",
    },
  },
  component: DateRangePicker,
  tags: ["autodocs"],
  args: {
    presets,
    startValue: "2026-10-04T09:00",
    endValue: "2026-10-11T09:00",
    triggerLabel: "Last 7 days",
    onStartChange: () => {},
    onEndChange: () => {},
    onPresetSelect: () => {},
  },
  argTypes: { presets: { control: false } },
  render: () => {
    const [active, setActive] = useState<string | undefined>("7d");
    const [start, setStart] = useState("2026-10-04T09:00");
    const [end, setEnd] = useState("2026-10-11T09:00");
    return (
      <DateRangePicker
        presets={presets}
        activePresetKey={active}
        startValue={start}
        endValue={end}
        triggerLabel={presets.find((p) => p.key === active)?.label ?? "Custom range"}
        onStartChange={(text) => {
          setActive(undefined);
          setStart(text);
        }}
        onEndChange={(text) => {
          setActive(undefined);
          setEnd(text);
        }}
        onPresetSelect={setActive}
        onClear={() => setActive(undefined)}
      />
    );
  },
} satisfies Meta<typeof DateRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
