/**
 * @vitest-environment jsdom
 *
 * How the toolbar divides its row: lens tabs grow, the right cluster does not.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import { useUIStore } from "../../../../../behavior/ui.store.ts";
import { Toolbar, toolbarCompactness } from "../toolbar.tsx";

vi.mock("../../../../../behavior/trace-host.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTraceHost: () => ({ hasPermission: () => true }),
}));
vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
  }),
}));
vi.mock("../../../../../behavior/explorer/use-project-has-traces.ts", () => ({
  useProjectHasTraces: () => ({ hasAnyTraces: true }),
}));
vi.mock("../../../../../behavior/trace-drawer.ts", () => ({
  useDismissTraceDrawer: () => vi.fn(),
}));
vi.mock("../../hooks/use-error-count.ts", () => ({ useErrorCount: () => ({ count: 0 }) }));
vi.mock("../../hooks/use-is-new-account.ts", () => ({ useIsNewAccount: () => false }));
vi.mock("../../onboarding/hooks/use-trace-explorer-tour-preference.ts", () => ({
  useTraceExplorerTourPreference: () => ({ dismiss: vi.fn() }),
}));
vi.mock("../../onboarding/index.ts", () => ({
  useTourEntryPoints: () => ({ onEndTour: vi.fn() }),
}));
vi.mock("../../onboarding/spotlights/spotlight-overlay.tsx", () => ({
  writeSpotlightFragment: vi.fn(),
}));

vi.mock("../columns-dropdown.tsx", () => ({
  ColumnsDropdown: ({ showLabel }: { showLabel?: boolean }) => (
    <div data-testid="columns" data-show-label={showLabel ? "" : undefined} />
  ),
}));
const drawer = vi.hoisted(() => ({ openDrawer: vi.fn() }));
vi.mock("@langwatch/browser-host/drawer", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDrawer: () => drawer,
}));
vi.mock("../grouping-select.tsx", () => ({
  GroupingSelect: () => <div data-testid="grouping" />,
}));
vi.mock("../density-select.tsx", () => ({ DensitySelect: () => <div data-testid="density" /> }));
vi.mock("../live-indicator.tsx", () => ({ LiveIndicator: () => <div data-testid="live" /> }));
vi.mock("../time-range-picker.tsx", () => ({
  TimeRangePicker: () => <div data-testid="time-range" />,
}));

beforeEach(() => {
  useExplorerStore.getState().clearAll();
});

afterEach(() => cleanup());

describe("the toolbar row", () => {
  describe("when the page renders", () => {
    /** @scenario Lens tabs take remaining horizontal space */
    it("lets the lens tabs grow and holds both right clusters at their own width", () => {
      const { container, getByTestId } = renderWithDesignSystem(<Toolbar />);

      const timeCluster = getByTestId("live").parentElement as HTMLElement;
      const viewCluster = getByTestId("columns").parentElement as HTMLElement;
      const tabs = container.querySelector('[data-scope="tabs"][data-part="root"]') as HTMLElement;
      const tabsBox = tabs.parentElement as HTMLElement;

      expect(getComputedStyle(tabs).flexGrow).toBe("1");
      expect(getComputedStyle(tabs).minWidth).toBe("0px");
      expect(getComputedStyle(tabsBox).flexGrow).toBe("1");
      for (const cluster of [timeCluster, viewCluster]) {
        expect(tabsBox.parentElement).toBe(cluster.parentElement);
        expect(getComputedStyle(cluster).flexShrink).toBe("0");
        expect(getComputedStyle(cluster).flexGrow).not.toBe("1");
        expect(tabsBox.compareDocumentPosition(cluster) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }
      expect(getByTestId("time-range").parentElement).toBe(timeCluster);
      expect(getByTestId("grouping").parentElement).toBe(timeCluster);
      expect(getByTestId("density").parentElement).toBe(timeCluster);
    });
  });
});

describe("the Filters button", () => {
  describe("given the filters sidebar is closed", () => {
    /** @scenario "The Filters button leads the lens row" */
    it("sits before the lens tabs, outside the right clusters", () => {
      useUIStore.getState().setSidebarCollapsed(true);
      const { container, getByRole, getByTestId } = renderWithDesignSystem(<Toolbar />);

      const filters = getByRole("button", { name: "Show filters sidebar" });
      const tabs = container.querySelector('[data-scope="tabs"][data-part="root"]') as HTMLElement;
      const tabsBox = tabs.parentElement as HTMLElement;
      const row = tabsBox.parentElement as HTMLElement;

      expect(row.contains(filters)).toBe(true);
      expect(getByTestId("live").parentElement?.contains(filters)).toBe(false);
      expect(filters.compareDocumentPosition(tabsBox) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  });

  describe("given the filters sidebar is open", () => {
    it("is not in the toolbar, since the sidebar carries its own close control", () => {
      useUIStore.getState().setSidebarCollapsed(false);
      const { queryByRole } = renderWithDesignSystem(<Toolbar />);

      expect(queryByRole("button", { name: "Show filters sidebar" })).toBeNull();
    });
  });
});

describe("the toolbar actions", () => {
  /** @scenario "The toolbar keeps its actions in sight" */
  it("shows Automate and the shortcuts button in the bar, with no overflow menu", async () => {
    useExplorerStore.getState().applyQueryText("status:error");
    const { getByRole, queryByRole } = renderWithDesignSystem(<Toolbar />);

    const automate = getByRole("button", { name: "Create an automation from the current filter" });
    expect(automate).toHaveTextContent("Automate");
    expect(getByRole("button", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(queryByRole("button", { name: "More toolbar actions" })).toBeNull();

    automate.click();
    expect(drawer.openDrawer).toHaveBeenCalledWith(
      "automation",
      expect.objectContaining({ initialSource: "trace", initialFilterQuery: "status:error" }),
    );
  });
});

describe("toolbarCompactness", () => {
  const at = (width: number) =>
    toolbarCompactness({ width, hasSampleToggle: false, hasTourLabel: false });

  /** @scenario "The toolbar keeps its actions in sight" */
  it("spells Columns when wide and sheds labels, then chevrons, as the bar narrows", () => {
    expect(at(1500)).toEqual({ wide: true, labelsCompact: false, chevronsCompact: false });
    expect(at(1430)).toEqual({ wide: false, labelsCompact: false, chevronsCompact: false });
    expect(at(1300)).toEqual({ wide: false, labelsCompact: true, chevronsCompact: false });
    expect(at(1000)).toEqual({ wide: false, labelsCompact: true, chevronsCompact: true });
  });
});
