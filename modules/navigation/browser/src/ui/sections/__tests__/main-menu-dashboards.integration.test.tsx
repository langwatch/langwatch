/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 * @see modules/insight/specs/insight-inbox.feature
 */

import {
  SavedDashboardsToken,
  type SavedDashboardsProps,
  StarredDashboardsToken,
} from "@langwatch/analytics-client";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { InsightsNavCountToken } from "@langwatch/insight-contract";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => declarations.current,
}));

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    annotation: { getPendingItemsCount: { useQuery: () => ({ data: { count: 0 } }) } },
    personalWorkspaceFeatures: { get: { useQuery: () => ({}) } },
    limits: { getUsage: { useQuery: () => ({}) } },
    ops: { getBadgeCounts: { useQuery: () => ({}) } },
    featureFlag: { isEnabledForEachOrganization: { useQuery: () => ({}) } },
  },
}));

import type { NavigationProject } from "@langwatch/navigation-contract";

import { WithStubNavigationHost } from "../../../testing.tsx";
import { ProductSidebar } from "../product-sidebar.tsx";

const PROJECT: NavigationProject = { id: "project-1", slug: "demo", name: "Demo" };

/** Stands in for analytics' lent list, echoing the address it was told is open. */
function LentList({ openPath }: SavedDashboardsProps) {
  return <div data-testid="saved-dashboards">Saved dashboards open:{openPath || "none"}</div>;
}

/** Stands in for analytics' lent Dashboards section, which decides itself what it draws. */
function LentStarred() {
  return <div data-testid="starred-dashboards">Pinned dashboards</div>;
}

/** Stands in for insight's lent unread pill. */
function LentInsightsCount() {
  return <span data-testid="insights-nav-count">3</span>;
}

const analyticsLends = uiDeclarations([
  {
    name: "analytics",
    installation: {
      capabilities: {},
      lends: [
        { token: SavedDashboardsToken, load: async () => ({ default: LentList }) },
        { token: StarredDashboardsToken, load: async () => ({ default: LentStarred }) },
      ],
    },
  },
  {
    name: "insight",
    installation: {
      capabilities: {},
      lends: [{ token: InsightsNavCountToken, load: async () => ({ default: LentInsightsCount }) }],
    },
  },
]);

function renderSidebar({
  surface,
  pathname,
  permissions = ["analytics:view"],
  dashboardsFlag = true,
  dashboardsLoading = false,
  organizationLoading = false,
  kind,
  insightsFlag = false,
}: {
  surface: "llm-ops" | "dashboards" | "gateway" | "governance" | "me" | "settings";
  pathname: string;
  permissions?: string[];
  dashboardsFlag?: boolean;
  dashboardsLoading?: boolean;
  organizationLoading?: boolean;
  kind?: string;
  insightsFlag?: boolean;
}) {
  declarations.current = analyticsLends;
  return renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        project: kind ? { ...PROJECT, kind } : PROJECT,
        pathname,
        permissions,
        isLoading: organizationLoading,
        flags: {
          release_dashboards: { enabled: dashboardsFlag, isLoading: dashboardsLoading },
          release_insights: { enabled: insightsFlag, isLoading: false },
        },
        commandBar: { shortcut: "⌘K", open: vi.fn(), trigger: null },
      }}
    >
      <ProductSidebar surface={surface} isCompact={false} />
    </WithStubNavigationHost>,
  );
}

afterEach(() => {
  cleanup();
  declarations.current = undefined;
});

describe("the Dashboards product sidebar", () => {
  describe("given a board is open", () => {
    /** @scenario "AC3 Sidebar matches the reference" */
    it("holds only Quick Search and the saved-dashboards list, marking the open board", async () => {
      renderSidebar({ surface: "dashboards", pathname: "/demo/dashboards/agent-flight-deck" });

      expect(screen.getByRole("button", { name: "Quick Search" })).toBeInTheDocument();
      expect(await screen.findByTestId("saved-dashboards")).toHaveTextContent(
        "open:agent-flight-deck",
      );
      expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
      expect(screen.queryByText("Observe")).toBeNull();
      expect(screen.queryByText("Test")).toBeNull();
      expect(screen.queryByText("Build")).toBeNull();
    });
  });

  describe("given a From LangWatch board is open", () => {
    it("hands the whole address under the area to the list", async () => {
      renderSidebar({ surface: "dashboards", pathname: "/demo/dashboards/curated/release" });

      expect(await screen.findByTestId("saved-dashboards")).toHaveTextContent(
        "open:curated/release",
      );
    });
  });

  describe("given the area's own address", () => {
    it("marks no board as open", async () => {
      renderSidebar({ surface: "dashboards", pathname: "/demo/dashboards" });

      expect(await screen.findByTestId("saved-dashboards")).toHaveTextContent("open:none");
    });
  });
});

describe("the Insights entry", () => {
  describe("given release_insights is on and the member holds analytics:view", () => {
    /** @scenario "The LLM Ops side menu holds the one Insights entry with its unread count" */
    it("sits first under Home in the LLM Ops sidebar, with the lent count", async () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", insightsFlag: true });

      const entry = screen.getByRole("link", { name: /^Insights/ });
      expect(screen.getAllByRole("link", { name: /Insights/ })).toHaveLength(1);
      expect(entry).toHaveAttribute("href", "/demo/insights");
      const links = screen.getAllByRole("link");
      expect(links[links.indexOf(entry) - 1]).toBe(screen.getByRole("link", { name: "Home" }));
      expect(await within(entry).findByTestId("insights-nav-count")).toHaveTextContent("3");
    });

    /** @scenario "No other product's side menu holds the Insights entry" */
    it.each([
      { surface: "dashboards" as const, pathname: "/demo/dashboards" },
      { surface: "gateway" as const, pathname: "/gateway/virtual-keys" },
    ])("is not in the $surface sidebar", async ({ surface, pathname }) => {
      renderSidebar({ surface, pathname, insightsFlag: true });

      await screen.findByRole("button", { name: "Quick Search" });
      expect(screen.queryByRole("link", { name: /Insights/ })).toBeNull();
    });

    /** @scenario "An aggregate project's side menu holds no Insights entry" */
    it("is not in an aggregate project's LLM Ops sidebar", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", insightsFlag: true, kind: "aggregate" });

      expect(screen.queryByRole("link", { name: /Insights/ })).toBeNull();
    });
  });

  describe("given release_insights is off or the member lacks analytics:view", () => {
    /** @scenario "The side menu shows no Insights entry while the flag is off" */
    it.each([
      { case: "the flag is off", insightsFlag: false, permissions: ["analytics:view"] },
      { case: "no analytics:view", insightsFlag: true, permissions: [] },
    ])("draws no Insights entry in the LLM Ops sidebar: $case", ({ insightsFlag, permissions }) => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", insightsFlag, permissions });

      expect(screen.queryByRole("link", { name: /Insights/ })).toBeNull();
    });
  });
});

describe("the LLM Ops sidebar", () => {
  describe("given the dashboards flag is on and the member holds analytics:view", () => {
    it("carries no Dashboards entry and no saved-dashboards list", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo" });

      expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Dashboards" })).toBeNull();
      expect(screen.queryByTestId("saved-dashboards")).toBeNull();
    });
  });

  describe("given the Analytics entry", () => {
    /** @scenario "AC3b The Analytics entry opens Dashboards when the project can reach them" */
    it("opens Dashboards with no pill when Dashboards is reachable", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo" });

      const link = screen.getByRole("link", { name: "Analytics" });
      expect(link).toHaveAttribute("href", "/demo/dashboards");
      expect(within(link).queryByText("Legacy")).toBeNull();
    });

    /** @scenario "AC3k The Analytics entry waits for the Dashboards answer" */
    it("shows no Analytics entry while the flag is still loading", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", dashboardsLoading: true });

      expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
    });

    /** @scenario "AC3p The Analytics entry waits for the permission read as well" */
    it("shows no Analytics entry while the grant is still being read", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", organizationLoading: true });

      expect(screen.queryByRole("link", { name: "Analytics" })).toBeNull();
    });

    /** @scenario "AC3p The Analytics entry waits for the permission read as well" */
    it("never shows the analytics address on a project switch before the grant settles", () => {
      const view = renderSidebar({
        surface: "llm-ops",
        pathname: "/demo",
        permissions: [],
        organizationLoading: true,
      });
      const seen = () =>
        screen.queryByRole("link", { name: "Analytics" })?.getAttribute("href") ?? null;
      expect(seen()).toBeNull();

      view.unmount();
      renderSidebar({ surface: "llm-ops", pathname: "/demo" });
      expect(seen()).toBe("/demo/dashboards");
    });

    /** @scenario "AC3q An aggregate project keeps the Analytics entry on analytics" */
    it("keeps an aggregate project on analytics even when Dashboards is reachable", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo/analytics", kind: "aggregate" });

      const link = screen.getByRole("link", { name: "Analytics" });
      expect(link).toHaveAttribute("href", "/demo/analytics");
      expect(link).toHaveAttribute("aria-current", "page");
    });

    /** @scenario "AC3m The Analytics entry is not marked active on a legacy analytics page when it leads to Dashboards" */
    it("is not marked active on a legacy analytics page when it leads to Dashboards", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo/analytics" });

      expect(screen.getByRole("link", { name: "Analytics" })).not.toHaveAttribute("aria-current");
    });

    /** @scenario "AC3n The Analytics entry is marked active on a legacy analytics page when it leads to analytics" */
    it("is marked active on a legacy analytics page when it leads to analytics", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo/analytics", dashboardsFlag: false });

      expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    /** @scenario "AC3h The Analytics entry opens analytics when Dashboards is out of reach" */
    it("opens analytics with no pill when Dashboards is not reachable", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", dashboardsFlag: false });

      const link = screen.getByRole("link", { name: "Analytics" });
      expect(link).toHaveAttribute("href", "/demo/analytics");
      expect(within(link).queryByText("Legacy")).toBeNull();
    });
  });
});

/** The lent section loads asynchronously, so its absence is only proven after a wait. */
async function expectNoSection() {
  await expect(screen.findByTestId("starred-dashboards", {}, { timeout: 300 })).rejects.toThrow(
    "Unable to find an element",
  );
}

describe("the Dashboards section analytics lends", () => {
  describe("given a member who can reach Dashboards, in LLM Ops", () => {
    /** @scenario "The LLM Ops sidebar has a Dashboards section listing the pinned dashboards" */
    it("draws analytics' section under the product's own pages", async () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo" });

      expect(await screen.findByTestId("starred-dashboards")).toBeInTheDocument();
      expect(screen.getByText("Observe")).toBeInTheDocument();
    });
  });

  describe("given the same member, in Gateway, Governance or Me", () => {
    /** @scenario "Only the LLM Ops sidebar shows the Dashboards section" */
    it.each([
      { surface: "gateway", pathname: "/gateway/virtual-keys" },
      { surface: "governance", pathname: "/governance" },
      { surface: "me", pathname: "/me" },
    ] as const)("draws no section in $surface", async ({ surface, pathname }) => {
      renderSidebar({ surface, pathname });

      await expectNoSection();
    });
  });

  describe("given the same member, in Dashboards", () => {
    /** @scenario "Only the LLM Ops sidebar shows the Dashboards section" */
    it("leaves the boards to the saved-dashboards list", async () => {
      renderSidebar({ surface: "dashboards", pathname: "/demo/dashboards" });

      expect(await screen.findByTestId("saved-dashboards")).toBeInTheDocument();
      await expectNoSection();
    });
  });

  describe("given a member who cannot reach Dashboards, in LLM Ops", () => {
    /** @scenario "The LLM Ops sidebar has a Dashboards section listing the pinned dashboards" */
    it("draws no section", async () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", permissions: [] });

      await expectNoSection();
    });
  });
});
