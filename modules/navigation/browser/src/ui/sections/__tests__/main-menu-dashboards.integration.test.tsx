/**
 * @vitest-environment jsdom
 * @see modules/dashboard/specs/dashboards-v1.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  uiDeclarations,
  type UiDeclarations,
  type UiSavedDashboardsProps,
} from "@langwatch/browser-host/declarations";
import { cleanup, render, screen } from "@testing-library/react";
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

import type { NavigationProject } from "../../../model/navigation-host.ts";
import { WithStubNavigationHost } from "../../../testing.tsx";
import { ProductSidebar } from "../product-sidebar.tsx";

const PROJECT: NavigationProject = { id: "project-1", slug: "demo", name: "Demo" };

/** Stands in for analytics' lent list, echoing the board it was told is open. */
function LentList({ activeDashboardId }: UiSavedDashboardsProps) {
  return (
    <div data-testid="saved-dashboards">Saved dashboards open:{activeDashboardId ?? "none"}</div>
  );
}

const analyticsLends = uiDeclarations([
  {
    name: "analytics",
    installation: {
      capabilities: { savedDashboards: { load: async () => ({ default: LentList }) } },
    },
  },
]);

function renderSidebar({
  surface,
  pathname,
}: {
  surface: "llm-ops" | "dashboards";
  pathname: string;
}) {
  declarations.current = analyticsLends;
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          project: PROJECT,
          pathname,
          permissions: ["analytics:view"],
          flags: { release_dashboards: { enabled: true, isLoading: false } },
          commandBar: { shortcut: "⌘K", open: vi.fn(), trigger: null },
        }}
      >
        <ProductSidebar surface={surface} isCompact={false} />
      </WithStubNavigationHost>
    </ChakraProvider>,
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
