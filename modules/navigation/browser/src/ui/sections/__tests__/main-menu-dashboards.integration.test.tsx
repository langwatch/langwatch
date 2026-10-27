/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import {
  SavedDashboardsToken,
  type SavedDashboardsProps,
  StarredDashboardsToken,
} from "@langwatch/analytics-client";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
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

/** Stands in for analytics' lent starred group, which draws itself only when stars exist. */
function LentStarred() {
  return <div data-testid="starred-dashboards">Starred dashboards</div>;
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
]);

function renderSidebar({
  surface,
  pathname,
  permissions = ["analytics:view"],
  dashboardsFlag = true,
  dashboardsLoading = false,
  organizationLoading = false,
}: {
  surface: "llm-ops" | "dashboards" | "gateway" | "settings";
  pathname: string;
  permissions?: string[];
  dashboardsFlag?: boolean;
  dashboardsLoading?: boolean;
  organizationLoading?: boolean;
}) {
  declarations.current = analyticsLends;
  return renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        project: PROJECT,
        pathname,
        permissions,
        isLoading: organizationLoading,
        flags: { release_dashboards: { enabled: dashboardsFlag, isLoading: dashboardsLoading } },
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

    /** @scenario "AC3k The Analytics entry waits for the Dashboards answer" */
    it("waits for the flag alone, not for the organization to load", () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", organizationLoading: true });

      expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute(
        "href",
        "/demo/dashboards",
      );
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

describe("the starred dashboards group", () => {
  describe("given a member who can reach Dashboards, in LLM Ops", () => {
    /** @scenario "Starred dashboards show in the other products' sidebars" */
    it("draws analytics' starred group under the product's own pages", async () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo" });

      expect(await screen.findByTestId("starred-dashboards")).toBeInTheDocument();
      expect(screen.getByText("Observe")).toBeInTheDocument();
    });
  });

  describe("given the Gateway sidebar", () => {
    /** @scenario "Starred dashboards show in the other products' sidebars" */
    it("draws the starred group there too", async () => {
      renderSidebar({ surface: "gateway", pathname: "/gateway/virtual-keys" });

      expect(await screen.findByTestId("starred-dashboards")).toBeInTheDocument();
    });
  });

  describe("given the Dashboards sidebar", () => {
    /** @scenario "Starred dashboards show in the other products' sidebars" */
    it("leaves the stars to the saved-dashboards list", async () => {
      renderSidebar({ surface: "dashboards", pathname: "/demo/dashboards" });

      await screen.findByTestId("saved-dashboards");
      expect(screen.queryByTestId("starred-dashboards")).toBeNull();
    });
  });

  describe("given a member who cannot reach Dashboards", () => {
    /** @scenario "Starred dashboards show in the other products' sidebars" */
    it("draws no starred group", async () => {
      renderSidebar({ surface: "llm-ops", pathname: "/demo", permissions: [] });

      await screen.findByRole("button", { name: "Quick Search" });
      expect(screen.queryByTestId("starred-dashboards")).toBeNull();
    });
  });
});
