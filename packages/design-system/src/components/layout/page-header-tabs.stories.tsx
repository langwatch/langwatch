import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { MenuItem, MenuSeparator } from "../overlays/menu.tsx";
import { PageTabs } from "./page-header-tabs.tsx";
import { PageLayout } from "./page-layout.tsx";

const meta = {
  title: "Navigation and layout/Page header tabs",
  parameters: {
    usage: {
      use: "A short set of routed sub-pages of one area, in its 64px header: each tab a link.",
      avoid: "Switching views inside a card: Tabs. Five or more real sub-pages: a section rail.",
    },
  },
  component: PageTabs,
  tags: ["autodocs"],
  args: { label: "Analytics pages", tabs: [], activeHref: "", onNavigate: () => {} },
} satisfies Meta<typeof PageTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

const TABS = [
  { label: "Overview", href: "/analytics" },
  { label: "Users", href: "/analytics/users", count: 12 },
  { label: "Topics", href: "/analytics/topics" },
  { label: "LLM metrics", href: "/analytics/metrics" },
];

export const InTheHeader: Story = {
  render: () => {
    const [active, setActive] = useState("/analytics");
    return (
      <PageLayout.Header actions={<PageLayout.HeaderButton>Show traces</PageLayout.HeaderButton>}>
        <PageLayout.Heading>Analytics</PageLayout.Heading>
        <PageLayout.Tabs
          label="Analytics pages"
          tabs={TABS}
          activeHref={active}
          onNavigate={setActive}
        >
          <PageLayout.TabMenu label="Dashboards">
            <MenuItem value="costs">Costs</MenuItem>
            <MenuItem value="quality">Quality</MenuItem>
            <MenuSeparator />
            <MenuItem value="add">Add dashboard</MenuItem>
          </PageLayout.TabMenu>
        </PageLayout.Tabs>
      </PageLayout.Header>
    );
  },
};

export const StackedOnPhones: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: () => {
    const [active, setActive] = useState("/cases");
    return (
      <div style={{ width: 320 }}>
        <PageLayout.Header>
          <PageLayout.Heading>A very long run plan name that needs to wrap</PageLayout.Heading>
          <PageLayout.Tabs
            stackOnMobile
            label="Agent testing pages"
            tabs={[
              { label: "Scenarios", href: "/cases", count: 128 },
              { label: "Results", href: "/results", count: 4096 },
            ]}
            activeHref={active}
            onNavigate={setActive}
          />
        </PageLayout.Header>
      </div>
    );
  },
};
