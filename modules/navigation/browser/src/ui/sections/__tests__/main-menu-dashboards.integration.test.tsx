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
import { cleanup, screen } from "@testing-library/react";
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
}: {
  surface: "llm-ops" | "dashboards" | "gateway" | "governance" | "me" | "settings";
  pathname: string;
  permissions?: string[];
}) {
  declarations.current = analyticsLends;
  return renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        project: PROJECT,
        pathname,
        permissions,
        flags: { release_dashboards: { enabled: true, isLoading: false } },
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
