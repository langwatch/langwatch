import { Skeleton, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { MetricTabs } from "./metric-tabs.tsx";

type Metric = "documents" | "cost" | "latency";

function Demo({ single = false, loading = false }: { single?: boolean; loading?: boolean }) {
  const [value, setValue] = useState<Metric>("documents");
  const items = [
    {
      value: "documents" as const,
      label: "Total documents",
      figure: loading ? <Skeleton height="32px" width="64px" /> : "1,284",
      content: <Text color="fg.muted">Documents per day.</Text>,
    },
    {
      value: "cost" as const,
      label: "Cost",
      figure: loading ? <Skeleton height="32px" width="64px" /> : "$42.10",
      content: <Text color="fg.muted">Spend per model.</Text>,
    },
    {
      value: "latency" as const,
      label: "Median latency",
      figure: loading ? <Skeleton height="32px" width="64px" /> : "812 ms",
      content: <Text color="fg.muted">Latency over time.</Text>,
    },
  ];
  return (
    <MetricTabs<Metric>
      label="Metrics"
      value={value}
      onValueChange={(next) => setValue(next.value)}
      items={single ? items.slice(0, 1) : items}
    />
  );
}

const meta = {
  title: "Navigation and layout/Metric tabs",
  component: MetricTabs,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "Tabs whose triggers are a live headline figure above a label; the selected one shows its chart or table below. Panels unmount when closed and arrows do not select until Enter, so arrowing past never fires a chart query.",
      avoid:
        "Controls inside a figure (it sits in a tab button), or ordinary section tabs: Content tabs.",
    },
  },
  args: { value: "docs", onValueChange: () => undefined, items: [], label: "Metrics" },
} satisfies Meta<typeof MetricTabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Demo /> };
export const FigureLoading: Story = { render: () => <Demo loading /> };
export const SingleMetric: Story = { render: () => <Demo single /> };
