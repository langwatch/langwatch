/**
 * @vitest-environment jsdom
 * @see modules/insight/specs/insight-inbox.feature
 */

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

/** Stands in for insight's lent unread pill. */
function LentInsightsCount() {
  return <span data-testid="insights-nav-count">3</span>;
}

const insightLends = uiDeclarations([
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
  kind,
  insightsFlag = false,
}: {
  surface: "llm-ops" | "dashboards" | "gateway";
  pathname: string;
  permissions?: string[];
  kind?: string;
  insightsFlag?: boolean;
}) {
  declarations.current = insightLends;
  return renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        project: kind ? { ...PROJECT, kind } : PROJECT,
        pathname,
        permissions,
        isLoading: false,
        flags: {
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
      renderSidebar({
        surface: "llm-ops",
        pathname: "/demo",
        insightsFlag: true,
        kind: "aggregate",
      });

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
